/**
 * INBOUND EMAIL WEBHOOK
 *
 * A mail provider POSTs a message here; it lands on the matter whose intake
 * address was in the recipients. This is what makes CC-ing the case address
 * work, and it is the only part of the feature that needs DNS.
 *
 * ── This endpoint is on the public internet ──────────────────────────────
 * It cannot require a login, because the caller is a mail provider. So the
 * threat model is explicit:
 *
 *   AUTHENTICATING THE CALLER. A shared secret in the `x-inbound-secret`
 *   header, compared in constant time. Without it anyone who finds the URL can
 *   write to any case file. If the provider cannot send custom headers, put the
 *   secret in the path instead and set INBOUND_EMAIL_SECRET to match — same
 *   strength, more likely to end up in someone's access log.
 *
 *   NOT AUTHENTICATING THE SENDER. It cannot be done. SMTP has no meaningful
 *   authentication and a From header is trivially forged, so a message that
 *   reaches a known intake address proves only that someone knew the address.
 *   Rather than pretend otherwise, every row records the envelope sender and
 *   whether SPF/DKIM passed, and the feed can show what is unverified. An
 *   intake address is a capability, which is why 003_email.sql makes the
 *   random half twelve hex characters rather than a sequence.
 *
 *   NOT TRUSTING THE CONTENT. Message bodies are stored and displayed as
 *   text, never as HTML, and never interpreted as instructions.
 *
 * ── Providers ────────────────────────────────────────────────────────────
 * Deliberately provider-agnostic, because the choice is not made yet and the
 * shape of "here is a raw message" is the same everywhere. Accepts:
 *
 *   - multipart/form-data with `email`, `raw`, `body-mime` or `message`
 *     (SendGrid Inbound Parse with "POST the raw, full MIME message" ticked;
 *      Mailgun's store/forward route)
 *   - a raw body of message/rfc822 or text/plain
 *     (Cloudflare Email Workers, or anything hand-rolled)
 */

import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase/service';
import { parseEml, normalizeEmail, parseAddressList } from '@/lib/domain/email';
import { matchIntakeSlugs, deliveredToAddresses } from '@/lib/domain/mailbox';
import { uploadEmailFiles, firmDomains, MAX_EMAIL_BYTES } from '@/lib/data/email-ingest';

// Uploads and MIME parsing need Node APIs and more than the Edge memory budget.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Constant-time compare, so the secret cannot be recovered by timing. */
function secretMatches(given, expected) {
  if (!given || !expected || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/** Pull the raw RFC-822 bytes out of whatever shape the provider used. */
async function rawMessage(request) {
  const type = request.headers.get('content-type') || '';

  if (type.includes('multipart/form-data') || type.includes('application/x-www-form-urlencoded')) {
    const form = await request.formData();
    for (const field of ['email', 'raw', 'body-mime', 'message']) {
      const v = form.get(field);
      if (!v) continue;
      if (typeof v === 'string') return { bytes: new TextEncoder().encode(v), form };
      return { bytes: new Uint8Array(await v.arrayBuffer()), form };
    }
    return { bytes: null, form };
  }

  return { bytes: new Uint8Array(await request.arrayBuffer()), form: null };
}

export async function POST(request) {
  const expected = process.env.INBOUND_EMAIL_SECRET;
  if (!expected) {
    // Fail closed. An unconfigured secret must not mean an open endpoint.
    return NextResponse.json({ error: 'Inbound email is not configured.' }, { status: 503 });
  }
  if (!secretMatches(request.headers.get('x-inbound-secret') || '', expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getServiceClient();
  if (!db) return NextResponse.json({ error: 'Database is not configured.' }, { status: 503 });

  let bytes, form;
  try {
    ({ bytes, form } = await rawMessage(request));
  } catch (err) {
    return NextResponse.json({ error: `Unreadable payload: ${err.message}` }, { status: 400 });
  }
  if (!bytes?.length) {
    return NextResponse.json({ error: 'No message in the payload.' }, { status: 400 });
  }
  if (bytes.length > MAX_EMAIL_BYTES) {
    // 413, not 500: a provider that understands this will stop retrying.
    return NextResponse.json({ error: 'Message too large.' }, { status: 413 });
  }

  const parsed = parseEml(bytes);

  /* --------------------------------------------------------------
   * Which matter?
   *
   * The ENVELOPE recipient is checked first and the headers second.
   * A BCC'd case address appears nowhere in the headers by design —
   * that is what BCC means — so header-only matching would silently
   * drop exactly the messages staff most expect to work.
   * -------------------------------------------------------------- */
  const envelopeTo = [];
  const rcpt = form?.get('to') || form?.get('recipient') || '';
  if (typeof rcpt === 'string' && rcpt) envelopeTo.push(...parseAddressList(rcpt));
  try {
    const envelope = form?.get('envelope');
    if (typeof envelope === 'string' && envelope) {
      const e = JSON.parse(envelope);
      for (const addr of [].concat(e.to || [])) envelopeTo.push(...parseAddressList(addr));
    }
  } catch {
    // A malformed envelope is not fatal; the header candidates still apply.
  }

  /*
   * `Delivered-To`, and it is not a nicety.
   *
   * The form fields above are SendGrid and Mailgun conventions. A RAW message
   * posted with no envelope beside it -- which is what the Apps Script poller
   * sends, because an RFC822 message has no envelope inside it -- has none of
   * them, and a BCC'd case address appears in no header either.
   *
   * Gmail writes `Delivered-To: cases+slug@...` even for a BCC, so on that
   * route this header IS the envelope. Without it, BCC -- the way staff most
   * often expect to file a message quietly -- would fail silently.
   */
  envelopeTo.push(...deliveredToAddresses(parsed.headers));

  const slugs = matchIntakeSlugs({
    envelopeTo,
    to: parsed.to,
    cc: parsed.cc,
    bcc: parsed.bcc,
  });

  if (!slugs.length) {
    // 200, not 404. A 4xx makes providers retry, then bounce to the sender,
    // and a bounce to a treating physician is a worse outcome than a dropped
    // message that nobody addressed to a case in the first place.
    return NextResponse.json({ ok: true, filed: 0, reason: 'no intake address in recipients' });
  }

  const { data: matters, error: lookupError } = await db
    .from('matter')
    .select('id, intake_slug, deleted_at')
    .in('intake_slug', slugs);

  if (lookupError) {
    return NextResponse.json({ error: lookupError.message }, { status: 500 });
  }

  const live = (matters || []).filter((m) => !m.deleted_at);
  if (!live.length) {
    return NextResponse.json({ ok: true, filed: 0, reason: 'no open matter for that address' });
  }

  /* --------------------------------------------------------------
   * Provenance. Recorded, not judged.
   * -------------------------------------------------------------- */
  const spf = String(form?.get('SPF') || form?.get('spf') || '');
  const dkim = String(form?.get('dkim') || '');
  const envelopeFrom = parseAddressList(
    typeof form?.get('from') === 'string' ? form.get('from') : ''
  )[0];

  const filed = [];
  const failed = [];

  // One row per matter. A message addressed to two cases belongs on both, and
  // the dedupe key is scoped per matter precisely so that stays possible.
  for (const matter of live) {
    const normalized = normalizeEmail(parsed, {
      matterId: matter.id,
      firmDomains: firmDomains(),
      receivedAt: new Date().toISOString(),
    });

    const uploaded = await uploadEmailFiles(db, { matterId: matter.id, parsed, bytes });
    if (!uploaded.ok) {
      failed.push({ matterId: matter.id, error: uploaded.error });
      continue;
    }

    const { data, error } = await db
      .from('activity')
      .insert({
        matter_id: matter.id,
        kind: 'email',
        subject: normalized.meta.subject,
        body: normalized.body,
        meta: {
          ...normalized.meta,
          envelopeFrom: envelopeFrom || null,
          spf: spf || null,
          dkim: dkim || null,
          // The single flag the UI reads. Absent SPF and DKIM, the sender is
          // unproven -- true of any message where the provider did not check.
          verified: /pass/i.test(spf) || /pass/i.test(dkim),
          viaIntakeAddress: matter.intake_slug,
        },
        dedupe_key: normalized.dedupeKey,
        attachments: uploaded.attachments,
        author_label: normalized.meta.from?.name || normalized.meta.from?.email || 'Mail',
        source: 'system',
      })
      .select('id')
      .single();

    // Already filed. The provider retried, or the address was in both To and
    // CC. Idempotent by design -- report success so it stops retrying.
    if (error?.code === '23505') {
      filed.push({ matterId: matter.id, duplicate: true });
      continue;
    }
    if (error) {
      failed.push({ matterId: matter.id, error: error.message });
      continue;
    }

    await db
      .from('matter')
      .update({ last_activity_at: new Date().toISOString() })
      .eq('id', matter.id);

    filed.push({ matterId: matter.id, activityId: data.id });
  }

  // A partial failure returns 500 so the provider retries; the rows that did
  // land are protected from duplication by the dedupe key.
  const status = failed.length ? 500 : 200;
  return NextResponse.json({ ok: !failed.length, filed, failed }, { status });
}

/** A health check the provider setup screens can hit. Reveals nothing. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    configured: Boolean(process.env.INBOUND_EMAIL_SECRET && process.env.SUPABASE_SERVICE_ROLE_KEY),
  });
}
