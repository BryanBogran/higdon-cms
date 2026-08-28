/**
 * The per-matter email address.
 *
 * Filevine renders it as a bare token — `RiveraMarcusZ10000000` — because
 * inside Filevine the domain is implicit. Ours has to be shown in full, since
 * staff will paste it into Outlook.
 *
 * The domain is a SUBDOMAIN, and that is not a detail. Pointing an MX record at
 * `higdonlawyers.com` itself would redirect the firm's live mail; pointing it at
 * `case.higdonlawyers.com` cannot touch it. Getting this wrong takes the firm's
 * email down, so the default is the safe one and the override is explicit.
 */

export const DEFAULT_INTAKE_DOMAIN = 'case.higdonlawyers.com';

export function intakeDomain() {
  return (process.env.NEXT_PUBLIC_INTAKE_MAIL_DOMAIN || DEFAULT_INTAKE_DOMAIN).trim().toLowerCase();
}

/** Full address for a matter, or '' when the matter has no slug yet. */
export function intakeAddress(matter) {
  const slug = matter?.intakeSlug || '';
  return slug ? `${slug}@${intakeDomain()}` : '';
}

/** Does this address belong to one of our matters? Used by the webhook. */
export function isIntakeAddress(email) {
  const [, domain] = String(email || '').toLowerCase().split('@');
  return domain === intakeDomain();
}

export function slugFromAddress(email) {
  const [local, domain] = String(email || '').toLowerCase().split('@');
  return domain === intakeDomain() ? local : '';
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
