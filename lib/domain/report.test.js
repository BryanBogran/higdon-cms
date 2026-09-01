import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SEVERITIES, LIMITS, validateReport, reportSubject, reportEmailBody,
} from '@/lib/domain/report';
import { buildMessage, assertHeaderSafe, encodeSubject } from '@/lib/google/mime';

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

test('a summary is the only thing required', () => {
  const r = validateReport({ summary: 'The SOL will not save' });
  assert.equal(r.ok, true);
  assert.equal(r.report.summary, 'The SOL will not save');
  assert.equal(r.report.severity, 'normal');
});

test('an empty summary is refused', () => {
  assert.equal(validateReport({ summary: '   ' }).ok, false);
  assert.equal(validateReport({}).ok, false);
  assert.match(validateReport({}).error, /what went wrong/);
});

test('an unknown severity falls back to normal rather than being rejected', () => {
  // The report matters more than the dropdown. Refusing a whole report over a
  // bad enum would lose the thing somebody took the trouble to write.
  assert.equal(validateReport({ summary: 'x', severity: 'catastrophic' }).report.severity, 'normal');
  assert.equal(validateReport({ summary: 'x', severity: 'blocking' }).report.severity, 'blocking');
});

test('long fields are clipped, not rejected', () => {
  const r = validateReport({
    summary: 'a'.repeat(500),
    detail: 'b'.repeat(20000),
  });
  assert.equal(r.report.summary.length, LIMITS.summary);
  assert.equal(r.report.detail.length, LIMITS.detail);
});

test('console errors are newest first and capped', () => {
  const errors = Array.from({ length: 30 }, (_, i) => `error ${i}`);
  const r = validateReport({ summary: 'x', consoleErrors: errors });
  assert.equal(r.report.consoleErrors.length, LIMITS.errors);
  assert.equal(r.report.consoleErrors[0], 'error 29', 'the last thrown is the one that broke it');
});

test('a non-array of console errors does not throw', () => {
  assert.deepEqual(validateReport({ summary: 'x', consoleErrors: 'oops' }).report.consoleErrors, []);
  assert.deepEqual(validateReport({ summary: 'x' }).report.consoleErrors, []);
});

/* ------------------------------------------------------------------ *
 * Formatting
 * ------------------------------------------------------------------ */

test('a blocking report is obvious in a subject line', () => {
  const { report } = validateReport({ summary: 'Cannot open any case', severity: 'blocking' });
  const subject = reportSubject(report, { displayName: 'Dana Ortiz' });
  assert.match(subject, /^\[BLOCKING\] /);
  assert.match(subject, /Dana Ortiz/);
  assert.match(subject, /Cannot open any case/);
});

test('the body leads with what the person wrote, then the context', () => {
  const { report } = validateReport({
    summary: 'The SOL will not save',
    detail: 'I typed 3/4/27 and it went blank.',
    page: '/matters/abc/case-info',
    userAgent: 'Mozilla/5.0',
    viewport: '1440x900',
    consoleErrors: ['TypeError: x is undefined'],
  });
  const body = reportEmailBody(report, { displayName: 'Dana Ortiz', email: 'dana@x.com' });
  assert.ok(body.startsWith('The SOL will not save'));
  assert.match(body, /I typed 3\/4\/27/);
  assert.match(body, /\/matters\/abc\/case-info/);
  assert.match(body, /TypeError: x is undefined/);
});

test('missing context reads as "not captured", not as blank', () => {
  const { report } = validateReport({ summary: 'x' });
  const body = reportEmailBody(report, {});
  assert.match(body, /Page:\s+\(not captured\)/);
  assert.match(body, /no JavaScript errors/);
});

/* ------------------------------------------------------------------ *
 * The email is built from untrusted strings — header injection
 * ------------------------------------------------------------------ */

test('A REPORTER CANNOT INJECT A HEADER THROUGH REPLY-TO', () => {
  /*
   * profile.email is citext with no format constraint and is self-writable by
   * its owner, so it is untrusted text that usually looks like an address.
   * Reply-To is exactly where it goes. A CRLF there would let any signed-in
   * user BCC every report offsite, or author a whole message body that leaves
   * with the firm's own SPF and DKIM.
   */
  assert.throws(
    () => buildMessage({
      to: 'paul@higdonlawyers.com',
      from: 'files@higdonlawyers.com',
      subject: 'report',
      text: 'body',
      replyTo: 'me@x.com\r\nBcc: exfil@attacker.tld',
    }),
    /Reply-To contains a line break/,
  );
});

test('a line break in the recipient is refused too', () => {
  assert.throws(
    () => buildMessage({ to: 'a@x.com\nBcc: b@y.com', from: 'f@x.com', subject: 's', text: 't' }),
    /Recipient contains a line break/,
  );
  assert.throws(
    () => buildMessage({ to: 'a@x.com', from: 'f@x.com\rX: y', subject: 's', text: 't' }),
    /Sender contains a line break/,
  );
});

test('a summary full of newlines is harmless — it is base64 in the subject', () => {
  // The reporter's own words are the most likely place for a newline, and they
  // must NOT be refused. Encoding rather than rejecting is why.
  const msg = buildMessage({
    to: 'a@x.com', from: 'f@x.com',
    subject: 'line one\r\nBcc: nope@evil.com',
    text: 'body\r\n\r\nwith blank lines',
  });
  assert.ok(!/^Bcc:/m.test(msg), 'nothing escaped into a header');
  assert.match(msg, /^Subject: =\?UTF-8\?B\?/m);
});

test('the header block ends exactly once', () => {
  const msg = buildMessage({ to: 'a@x.com', from: 'f@x.com', subject: 's', text: 'b' });
  const [headers] = msg.split('\r\n\r\n');
  assert.equal(headers.split('\r\n').length, 6, 'To, From, Subject, MIME, Type, Encoding');
});

test('a UTF-8 subject survives', () => {
  assert.equal(encodeSubject('Ureña'), `=?UTF-8?B?${Buffer.from('Ureña', 'utf8').toString('base64')}?=`);
});

test('assertHeaderSafe passes an ordinary address through unchanged', () => {
  assert.equal(assertHeaderSafe('Recipient', 'dana@higdonlawyers.com'), 'dana@higdonlawyers.com');
  assert.equal(assertHeaderSafe('Recipient', undefined), '');
});

test('every severity has a label', () => {
  for (const s of SEVERITIES) assert.ok(s.key && s.label, JSON.stringify(s));
});
