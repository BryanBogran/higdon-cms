/**
 * The per-matter email address.
 *
 * Filevine renders it as a bare token — `RiveraMarcusZ10000000` — because
 * inside Filevine the domain is implicit. Ours has to be shown in full, since
 * staff will paste it into Outlook.
 *
 * ── Two shapes, and why the firm uses the second ─────────────────────────
 *
 * SUBDOMAIN     RiveraMarcus7f3a9c2e1b04@case.higdonlawyers.com
 * PLUS          cases+RiveraMarcus7f3a9c2e1b04@higdonlawyers.com
 *
 * The subdomain form is the nicer address and needs an MX record. The domain
 * here sits on Wix, whose DNS editor is limited, and an MX record next to a
 * firm's live mail is the single most dangerous step in this feature: point it
 * at `higdonlawyers.com` instead of `case.higdonlawyers.com` and every client
 * email, every carrier email, stops arriving until someone notices.
 *
 * The plus form needs NO DNS AT ALL. Everything lands in one real Workspace
 * mailbox, `cases@`, which the firm already has the ability to read — the
 * service account with domain-wide delegation is already doing Drive. So the
 * risky step disappears and no new vendor is involved.
 *
 * Both are supported because the trade is a deployment fact, not a permanent
 * one. Set NEXT_PUBLIC_INTAKE_MAIL_USER to switch to plus-addressing; leave it
 * unset for the subdomain.
 *
 * ⚠️ Existing addresses change shape when this setting changes. The slug does
 * not, so mail to an old address still resolves to the right matter as long as
 * the old route is still delivering — but staff will have copied the old form
 * into calendar invites and email signatures. Change it once, before the
 * addresses are handed out.
 */

export const DEFAULT_INTAKE_DOMAIN = 'case.higdonlawyers.com';

export function intakeDomain() {
  return (process.env.NEXT_PUBLIC_INTAKE_MAIL_DOMAIN || DEFAULT_INTAKE_DOMAIN).trim().toLowerCase();
}

/** The mailbox everything lands in, for plus-addressing. '' means subdomain mode. */
export function intakeUser() {
  return (process.env.NEXT_PUBLIC_INTAKE_MAIL_USER || '').trim().toLowerCase();
}

/**
 * Gmail ignores dots in the local part, so `c.a.s.e.s` and `cases` are the
 * same mailbox. Compared without them, or a sender who typed the address with
 * a stray dot would file nowhere and nobody would know why.
 */
const undot = (s) => String(s || '').replace(/\./g, '');

/** Full address for a matter, or '' when the matter has no slug yet. */
export function intakeAddress(matter) {
  const slug = matter?.intakeSlug || '';
  if (!slug) return '';
  const user = intakeUser();
  return user ? `${user}+${slug}@${intakeDomain()}` : `${slug}@${intakeDomain()}`;
}

export function slugFromAddress(email) {
  const [local = '', domain = ''] = String(email || '').toLowerCase().split('@');
  if (domain !== intakeDomain()) return '';

  const user = intakeUser();
  if (!user) return local;

  /*
   * `cases+slug`. The split is on the FIRST plus only: a slug cannot contain
   * one, but splitting on all of them would silently truncate an address
   * somebody mangled rather than rejecting it.
   *
   * A bare `cases@` with no tag returns '' — it is the mailbox itself, not a
   * matter, and mail sent straight to it belongs to no case.
   */
  const plus = local.indexOf('+');
  if (plus < 0) return '';
  if (undot(local.slice(0, plus)) !== undot(user)) return '';
  return local.slice(plus + 1);
}

/** Does this address belong to one of our matters? Used by the webhook. */
export function isIntakeAddress(email) {
  return Boolean(slugFromAddress(email));
}

/**
 * Which matters is this message addressed to?
 *
 * The ENVELOPE recipient matters more than the headers, and that is the whole
 * subtlety. A BCC'd case address appears in NO header — that is what BCC means
 * — so matching on To and Cc alone silently drops exactly the messages staff
 * most expect to work, and drops them without an error anyone would see.
 *
 * Returns lowercase slugs, deduplicated. One message can legitimately be
 * addressed to two matters (a client with two claims), so this is a list.
 */
export function matchIntakeSlugs({ envelopeTo = [], to = [], cc = [], bcc = [] } = {}) {
  const seen = new Set();
  for (const addr of [...envelopeTo, ...to, ...cc, ...bcc]) {
    const slug = slugFromAddress(typeof addr === 'string' ? addr : addr?.email);
    if (slug) seen.add(slug);
  }
  return [...seen];
}

/**
 * Headers that carry the address a message was actually DELIVERED to.
 *
 * This is what replaces the envelope when a raw message arrives with no
 * envelope beside it — which is the case for the Apps Script poller, because
 * a raw RFC822 message has no envelope in it.
 *
 * It is not a nicety. Gmail writes `Delivered-To: cases+slug@…` even when the
 * address was BCC'd, so this is the ONLY way a BCC'd case address is
 * recoverable on this route. Without it, BCC — the way staff most often expect
 * to file a message quietly — would fail silently.
 */
export function deliveredToAddresses(headers = {}) {
  const out = [];
  for (const key of ['delivered-to', 'x-original-to', 'x-forwarded-to', 'envelope-to']) {
    const value = headers[key];
    for (const v of [].concat(value || [])) {
      const addr = String(v || '').trim().replace(/^.*<|>.*$/g, '');
      if (addr.includes('@')) out.push(addr.toLowerCase());
    }
  }
  return out;
}
