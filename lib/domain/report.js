/**
 * "Something is wrong with this" — validating and formatting a report.
 *
 * Pure, so the truncation limits and the email body can be tested without a
 * database or a mail server.
 */

export const SEVERITIES = [
  { key: 'blocking', label: 'I cannot work — this is blocking me' },
  { key: 'normal', label: 'Something is wrong, but I can carry on' },
  { key: 'minor', label: 'Minor — a typo, or something that looks off' },
];

const SEVERITY_KEYS = new Set(SEVERITIES.map((s) => s.key));

/*
 * Caps. Not for storage cost -- a text column does not care -- but because
 * these arrive from a browser and go into an email. A megabyte of pasted
 * console output makes the report unreadable and the message undeliverable,
 * and the useful part is always in the first few lines.
 */
export const LIMITS = { summary: 200, detail: 5000, page: 500, userAgent: 400, errors: 10 };

const clip = (v, n) => String(v ?? '').trim().slice(0, n);

/**
 * @returns {{ok: true, report} | {ok: false, error: string}}
 *
 * Only `summary` is required. Everything else is either optional or captured
 * for the reporter, because the alternative to a thin report is no report:
 * someone who has to fill in six fields to say "the SOL is not saving" closes
 * the dialog and tells nobody.
 */
export function validateReport(input = {}) {
  const summary = clip(input.summary, LIMITS.summary);
  if (!summary) return { ok: false, error: 'Say briefly what went wrong.' };

  const severity = SEVERITY_KEYS.has(input.severity) ? input.severity : 'normal';

  return {
    ok: true,
    report: {
      summary,
      detail: clip(input.detail, LIMITS.detail),
      severity,
      page: clip(input.page, LIMITS.page),
      userAgent: clip(input.userAgent, LIMITS.userAgent),
      viewport: clip(input.viewport, 40),
      // Newest first: the error that broke the page is the last one thrown,
      // and it is the one worth reading.
      consoleErrors: (Array.isArray(input.consoleErrors) ? input.consoleErrors : [])
        .slice(-LIMITS.errors)
        .reverse()
        .map((e) => clip(e, 500))
        .filter(Boolean),
    },
  };
}

const SEVERITY_PREFIX = { blocking: '[BLOCKING] ', normal: '', minor: '[minor] ' };

/** Subject line. The severity leads, so a blocking report is obvious in a list. */
export function reportSubject(report, reporter) {
  const who = reporter?.displayName || reporter?.email || 'someone';
  return `${SEVERITY_PREFIX[report.severity] ?? ''}CMS report from ${who}: ${report.summary}`
    .slice(0, 200);
}

/**
 * The email body.
 *
 * Ordered by what is read first. The reporter's own words lead; the captured
 * context follows, because it is what makes the report actionable but is not
 * what anyone reads first.
 */
export function reportEmailBody(report, reporter, { when = '' } = {}) {
  const lines = [
    report.summary,
    '',
  ];

  if (report.detail) lines.push(report.detail, '');

  lines.push(
    '───────────────',
    `Reported by:  ${reporter?.displayName || 'unknown'}${reporter?.email ? ` <${reporter.email}>` : ''}`,
    `Severity:     ${report.severity}`,
    `Page:         ${report.page || '(not captured)'}`,
    `When:         ${when || '(not captured)'}`,
    `Browser:      ${report.userAgent || '(not captured)'}`,
    `Window:       ${report.viewport || '(not captured)'}`,
  );

  if (report.consoleErrors.length) {
    lines.push('', `Errors the browser had already thrown (newest first):`);
    for (const e of report.consoleErrors) lines.push(`  · ${e}`);
  } else {
    lines.push('', 'The browser reported no JavaScript errors.');
  }

  return lines.join('\n');
}
