/**
 * "Something is wrong with this" — receives a report, stores it, emails it.
 *
 * ── The order is the design ───────────────────────────────────────────────
 *
 * STORE FIRST, EMAIL SECOND, and report success on the store alone.
 *
 * A report that only ever becomes an email is lost whenever the send fails,
 * and the send is by far the likeliest part to fail: an unset variable, a
 * scope missing from the Admin console, a Gmail quota. The person who filed it
 * has already moved on believing it arrived. So the row is written first and
 * always, `emailed_at` records whether the notification also went out, and a
 * null there is something to look at rather than a report nobody has.
 *
 * The response says which of the two happened, and the dialog tells the truth
 * about it rather than showing a tick either way.
 *
 * ── It runs as the signed-in user ─────────────────────────────────────────
 *
 * Not the service role. RLS applies, `reported_by` is taken from the SESSION
 * rather than the request body — a client-supplied one would let anyone file a
 * report as anybody — and an unauthenticated POST is refused, because an open
 * insert endpoint on a public URL is a spam target and a report is worth
 * little without knowing who sent it.
 */

import { NextResponse } from 'next/server';
import {
  getSupabaseServerClient, getCurrentUser, isServerSupabaseConfigured,
} from '@/lib/supabase/server';
import { validateReport, reportSubject, reportEmailBody } from '@/lib/domain/report';
import { sendMail, isGmailConfigured } from '@/lib/google/gmail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  if (!isServerSupabaseConfigured()) {
    return NextResponse.json(
      { error: 'Running on local storage — there is nowhere to file a report.' },
      { status: 503 },
    );
  }

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Unreadable request.' }, { status: 400 });

  const checked = validateReport(body);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
  const report = checked.report;

  const db = await getSupabaseServerClient();
  const { data: profile } = await db
    .from('profile').select('display_name, email').eq('id', user.id).maybeSingle();

  const reporter = {
    displayName: profile?.display_name || user.email?.split('@')[0] || 'unknown',
    email: profile?.email || user.email || '',
  };

  /* -------- 1. store, always -------- */
  const { data: row, error } = await db
    .from('bug_report')
    .insert({
      reported_by: user.id,
      reporter_label: reporter.displayName,
      summary: report.summary,
      detail: report.detail || null,
      severity: report.severity,
      page: report.page || null,
      user_agent: report.userAgent || null,
      viewport: report.viewport || null,
      console_errors: report.consoleErrors,
    })
    .select('id, created_at')
    .single();

  if (error) {
    // Nothing was stored, so there is no half-success to describe. 42P01 is
    // the table not being there, which is a migration nobody ran rather than
    // a bug in the report.
    const missing = error.code === '42P01' || /schema cache/i.test(error.message || '');
    return NextResponse.json({
      error: missing
        ? 'Reports are not set up yet — run supabase/013_bug_report.sql.'
        : error.message,
    }, { status: 500 });
  }

  /* -------- 2. email, best effort -------- */
  const to = process.env.BUG_REPORT_TO || '';
  let emailed = false;
  let emailError = '';

  if (!to) {
    emailError = 'BUG_REPORT_TO is not set, so no notification was sent.';
  } else if (!isGmailConfigured()) {
    emailError = 'Google sending is not configured, so no notification was sent.';
  } else {
    const sent = await sendMail({
      to,
      subject: reportSubject(report, reporter),
      text: reportEmailBody(report, reporter, { when: row.created_at }),
      /*
       * So a reply reaches the person who reported it rather than the mailbox
       * it was sent from. This is the untrusted value -- profile.email is
       * self-writable and unconstrained -- and lib/google/mime.js refuses it
       * outright if it carries a line break.
       */
      replyTo: reporter.email || undefined,
    });
    emailed = sent.ok;
    if (!sent.ok) emailError = sent.error;
  }

  if (emailed) {
    // Not awaited for correctness -- the report is already safe, and failing
    // to stamp it is a worse thing to report than the thing being reported.
    await db.from('bug_report').update({ emailed_at: new Date().toISOString() }).eq('id', row.id);
  }

  return NextResponse.json({ ok: true, id: row.id, saved: true, emailed, emailError });
}
