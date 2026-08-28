import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseEml,
  parseHeaders,
  parseAddressList,
  parseContentType,
  decodeWords,
  decodeQuotedPrintable,
  htmlToText,
  parseEmailDate,
  emailDirection,
  emailDedupeKey,
  normalizeEmail,
  safeFilename,
  bytesToBinary,
  binaryToBytes,
} from './email.js';

const FIRM = ['higdonlawyers.com'];

/** CRLF, because that is what a real .eml uses and LF-only hides bugs. */
const eml = (s) => s.replace(/\n/g, '\r\n');

// The message from the Filevine screenshot, reconstructed.
const HIPAA_EML = eml(`Message-ID: <CAF7x9@mail.higdonlawyers.com>
Date: Tue, 25 Aug 2026 15:23:11 -0500
From: "Whitfield, Dana" <records@higdonlawyers.com>
To: "Call Center" <info@northsideurgentcare.com>, RiveraMarcusZ10000000@case.higdonlawyers.com
Subject: Re: HIPAA: Marcus Rivera
Content-Type: multipart/mixed; boundary="BOUND1"

--BOUND1
Content-Type: text/plain; charset="utf-8"
Content-Transfer-Encoding: quoted-printable

Please find the signed HIPAA authorization attached.=20

Thank you,
Dana
--BOUND1
Content-Type: application/pdf; name="HIPAA Authorization.pdf"
Content-Disposition: attachment; filename="HIPAA Authorization.pdf"
Content-Transfer-Encoding: base64

JVBERi0xLjQK
--BOUND1--
`);

test('parses the headers a case file actually needs', () => {
  const m = parseEml(HIPAA_EML);
  assert.equal(m.subject, 'Re: HIPAA: Marcus Rivera');
  assert.equal(m.from.email, 'records@higdonlawyers.com');
  assert.equal(m.from.name, 'Whitfield, Dana');
  assert.equal(m.to.length, 2);
  assert.equal(m.to[1].email, 'riveramarcusz10000000@case.higdonlawyers.com');
  assert.equal(m.messageId, 'CAF7x9@mail.higdonlawyers.com', 'angle brackets stripped');
});

test('a display name containing a comma does not split the address list', () => {
  // The single most common real input, and the one a naive split(",") breaks.
  const list = parseAddressList('"Rivera, Marcus" <v@x.com>, info@northsideurgentcare.com');
  assert.equal(list.length, 2);
  assert.equal(list[0].name, 'Rivera, Marcus');
  assert.equal(list[0].email, 'v@x.com');
  assert.equal(list[1].email, 'info@northsideurgentcare.com');
});

test('quoted-printable body is decoded, not shown raw', () => {
  const m = parseEml(HIPAA_EML);
  assert.match(m.bodyText, /signed HIPAA authorization attached\./);
  assert.ok(!m.bodyText.includes('=20'), 'no encoding artefacts reach the feed');
});

test('attachments come out with their real names and bytes', () => {
  const m = parseEml(HIPAA_EML);
  assert.equal(m.attachments.length, 1);
  assert.equal(m.attachments[0].filename, 'HIPAA Authorization.pdf');
  assert.equal(m.attachments[0].contentType, 'application/pdf');
  assert.equal(bytesToBinary(m.attachments[0].bytes).slice(0, 5), '%PDF-', 'base64 decoded');
});

test('an encoded subject is readable — an accented client name is common', () => {
  assert.equal(decodeWords('=?UTF-8?B?R29uesOhbGV6IGRlbWFuZA==?='), 'González demand');
  assert.equal(decodeWords('=?UTF-8?Q?Gonz=C3=A1lez?= demand'), 'González demand');
  // Whitespace BETWEEN encoded words is folding, not content.
  assert.equal(decodeWords('=?UTF-8?Q?Gonz=C3=A1?= =?UTF-8?Q?lez?='), 'González');
  assert.equal(decodeWords('plain subject'), 'plain subject', 'untouched when not encoded');
});

test('multipart/alternative prefers the plain text part', () => {
  const alt = eml(`From: a@b.com
Subject: Alt
Content-Type: multipart/alternative; boundary="B"

--B
Content-Type: text/plain; charset="utf-8"

The plain version.
--B
Content-Type: text/html; charset="utf-8"

<p>The <b>html</b> version.</p>
--B--
`);
  const m = parseEml(alt);
  assert.equal(m.bodyText, 'The plain version.');
  assert.ok(m.bodyHtml.includes('<b>html</b>'), 'html kept, for display later');
});

test('an html-only message still produces readable text', () => {
  const only = eml(`From: a@b.com
Subject: H
Content-Type: text/html; charset="utf-8"

<p>Records are ready.</p><p>Call us&nbsp;&amp; confirm.</p>
`);
  assert.equal(parseEml(only).bodyText, 'Records are ready.\n\nCall us & confirm.');
});

test('a header folded across lines is rejoined', () => {
  const h = parseHeaders('Subject: a very long\r\n  folded subject\r\nFrom: x@y.com');
  assert.equal(h.subject[0], 'a very long folded subject');
});

test('Received repeats, and every hop is kept', () => {
  // Collapsing this would discard the delivery path -- the only evidence of
  // when a message really arrived if the Date header is wrong.
  const h = parseHeaders('Received: from a\r\nReceived: from b\r\nFrom: x@y.com');
  assert.deepEqual(h.received, ['from a', 'from b']);
});

test('content-type parameters survive quoting', () => {
  const ct = parseContentType('multipart/mixed; boundary="--=_Part_1_2"; charset=UTF-8');
  assert.equal(ct.type, 'multipart/mixed');
  assert.equal(ct.params.boundary, '--=_Part_1_2');
  assert.equal(ct.params.charset, 'UTF-8');
});

test('direction is decided by the sender, not by the mailbox', () => {
  const staff = { email: 'records@higdonlawyers.com' };
  const outside = { email: 'info@northsideurgentcare.com' };
  assert.equal(emailDirection(staff, FIRM), 'sent');
  assert.equal(emailDirection(outside, FIRM), 'received');
  assert.equal(emailDirection(null, FIRM), 'received', 'unknown sender is not ours');
});

test('an unparseable Date returns null rather than an Invalid Date', () => {
  assert.equal(parseEmailDate('Tue, 25 Aug 2026 15:23:11 -0500'), '2026-08-25T20:23:11.000Z');
  assert.equal(parseEmailDate('not a date'), null);
  assert.equal(parseEmailDate(''), null);
});

test('the dedupe key is what stops a CCd thread arriving twice', () => {
  const m = parseEml(HIPAA_EML);
  assert.equal(emailDedupeKey('M1', m.messageId), 'mail:M1:CAF7x9@mail.higdonlawyers.com');
  // Same message, same matter, same key -- the unique index does the rest.
  assert.equal(emailDedupeKey('M1', m.messageId), emailDedupeKey('M1', parseEml(HIPAA_EML).messageId));
  // A different matter is a different record: one email can be filed on two.
  assert.notEqual(emailDedupeKey('M2', m.messageId), emailDedupeKey('M1', m.messageId));
  assert.equal(emailDedupeKey('M1', ''), null, 'no Message-ID, no dedupe claim');
});

test('normalize produces an activity row plus the files to upload', () => {
  const n = normalizeEmail(parseEml(HIPAA_EML), { matterId: 'M1', firmDomains: FIRM });
  assert.equal(n.kind, 'email');
  assert.equal(n.matterId, 'M1');
  assert.equal(n.meta.direction, 'sent');
  assert.equal(n.meta.subject, 'Re: HIPAA: Marcus Rivera');
  assert.equal(n.meta.sentAt, '2026-08-25T20:23:11.000Z');
  assert.match(n.body, /signed HIPAA authorization/);

  // The original .eml leads, because it is the record the others hang off.
  assert.equal(n.pendingFiles[0].role, 'original');
  assert.equal(n.pendingFiles[0].contentType, 'message/rfc822');
  assert.equal(n.pendingFiles[1].filename, 'HIPAA Authorization.pdf');
});

test('normalize falls back to arrival time when the Date header is missing', () => {
  const noDate = eml('From: a@b.com\nSubject: S\n\nbody\n');
  const n = normalizeEmail(parseEml(noDate), { matterId: 'M1', receivedAt: '2026-08-27T12:00:00.000Z' });
  assert.equal(n.meta.sentAt, '2026-08-27T12:00:00.000Z');
});

test('a filename cannot escape its storage folder', () => {
  assert.equal(safeFilename('../../etc/passwd'), '.._.._etc_passwd');
  assert.equal(safeFilename('Re: HIPAA / records'), 'Re_ HIPAA _ records');
  assert.equal(safeFilename('x'.repeat(300)).length, 120);
  assert.equal(safeFilename(null), '');
});

test('bytes survive the latin1 round trip', () => {
  // Every byte, including 0x80-0x9F where TextDecoder("latin1") would corrupt.
  const all = new Uint8Array(256).map((_, i) => i);
  assert.deepEqual(binaryToBytes(bytesToBinary(all)), all);
});

test('a malformed message degrades instead of throwing', () => {
  assert.doesNotThrow(() => parseEml(''));
  assert.doesNotThrow(() => parseEml('garbage with no headers at all'));
  assert.doesNotThrow(() => parseEml(eml('Content-Type: multipart/mixed; boundary="X"\n\nno parts')));
  const m = parseEml('');
  assert.equal(m.from, null);
  assert.deepEqual(m.to, []);
});

test('html stripping does not leak script contents', () => {
  assert.equal(htmlToText('<script>alert(1)</script><p>Hi</p>'), 'Hi');
  assert.equal(htmlToText('<style>p{}</style>Hi'), 'Hi');
});

test('quoted-printable soft breaks rejoin the line', () => {
  const out = new TextDecoder().decode(decodeQuotedPrintable('a very long li=\r\nne'));
  assert.equal(out, 'a very long line');
});

/* ------------------------------------------------------------------ *
 * The per-matter address
 * ------------------------------------------------------------------ */

import { intakeAddress, isIntakeAddress, slugFromAddress, DEFAULT_INTAKE_DOMAIN } from './mailbox.js';

test('the intake domain is a subdomain — pointing MX at the firm domain kills their mail', () => {
  assert.match(DEFAULT_INTAKE_DOMAIN, /^[a-z0-9-]+\.higdonlawyers\.com$/);
  assert.notEqual(DEFAULT_INTAKE_DOMAIN, 'higdonlawyers.com');
});

test('an address round-trips back to its slug', () => {
  const matter = { intakeSlug: 'RiveraMarcus1a2b3c4d5e6f' };
  const addr = intakeAddress(matter);
  assert.equal(addr, `RiveraMarcus1a2b3c4d5e6f@${DEFAULT_INTAKE_DOMAIN}`);
  assert.equal(slugFromAddress(addr), 'riveramarcus1a2b3c4d5e6f');
  assert.ok(isIntakeAddress(addr));
});

test('a matter with no slug shows no address rather than a broken one', () => {
  assert.equal(intakeAddress({}), '');
  assert.equal(intakeAddress(null), '');
});

test('an address on another domain is not ours', () => {
  assert.equal(slugFromAddress('records@higdonlawyers.com'), '', 'the firm domain is not the intake domain');
  assert.equal(slugFromAddress('someone@gmail.com'), '');
  assert.equal(isIntakeAddress('info@northsideurgentcare.com'), false);
  assert.equal(isIntakeAddress(''), false);
});

/* ------------------------------------------------------------------ *
 * Routing an inbound message to a matter
 * ------------------------------------------------------------------ */

import { matchIntakeSlugs } from './mailbox.js';

const at = (slug) => `${slug}@${DEFAULT_INTAKE_DOMAIN}`;

test('a BCCd case address is found via the envelope, not the headers', () => {
  // This is the case that matters. Staff BCC so the recipient does not see the
  // firm's internal plumbing -- and BCC is, by definition, in no header. A
  // header-only match drops this message and shows nobody an error.
  const slugs = matchIntakeSlugs({
    envelopeTo: [{ email: at('SmithJane1a2b3c4d5e6f') }],
    to: [{ email: 'adjuster@carrier.com' }],
    cc: [],
  });
  assert.deepEqual(slugs, ['smithjane1a2b3c4d5e6f']);
});

test('a message addressed to two cases files on both', () => {
  const slugs = matchIntakeSlugs({
    to: [{ email: at('SmithJane1111') }, { email: 'doctor@clinic.com' }],
    cc: [{ email: at('SmithJohn2222') }],
  });
  assert.deepEqual(slugs.sort(), ['smithjane1111', 'smithjohn2222']);
});

test('the same address in To and the envelope yields one slug, not two', () => {
  const slugs = matchIntakeSlugs({
    envelopeTo: [{ email: at('SmithJane1111') }],
    to: [{ email: at('smithjane1111') }],
  });
  assert.equal(slugs.length, 1, 'deduplicated, or the message files twice');
});

test('ordinary mail with no case address routes nowhere', () => {
  assert.deepEqual(
    matchIntakeSlugs({ to: [{ email: 'paul@higdonlawyers.com' }], cc: [{ email: 'x@y.com' }] }),
    [],
    'the firm domain is not the intake domain -- ordinary staff mail must not be filed'
  );
  assert.deepEqual(matchIntakeSlugs({}), []);
  assert.deepEqual(matchIntakeSlugs(), []);
});

test('plain strings work too, since providers send envelopes both ways', () => {
  assert.deepEqual(matchIntakeSlugs({ envelopeTo: [at('Abc123456789')] }), ['abc123456789']);
});
