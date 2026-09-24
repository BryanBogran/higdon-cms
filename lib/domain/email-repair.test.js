import test from 'node:test';
import assert from 'node:assert/strict';

import { parseEml, storageKey } from './email.js';
import { collidingPaths, hasRealLoss, planAttachmentRepair } from './email-repair.js';

/** CRLF, because that is what a real .eml uses and LF-only hides bugs. */
const eml = (s) => s.replace(/\n/g, '\r\n');

const part = (name, body) => `--b
Content-Type: image/png; name="${name}"
Content-Disposition: inline; filename="${name}"
Content-Transfer-Encoding: base64

${Buffer.from(body).toString('base64')}
`;

/** A message shaped like the Torres thread: repeated names, different images. */
const parsed = parseEml(new TextEncoder().encode(eml(`Message-ID: <thread@carrier.example>
From: adj@carrier.example
Subject: Re: [EXTERNAL] Claim
Content-Type: multipart/mixed; boundary="b"

--b
Content-Type: text/plain

See below.
${part('image.png', 'screenshot one')}${part('image.png', 'screenshot two!')}${part('report.pdf', 'pdf')}${part('Outlook-Please con.png', 'x')}${part('Outlook-Please con.png', 'x')}--b--
`)));

const FOLDER = 'm1/email/thread@carrier.example';

/** The row exactly as ingest wrote it BEFORE the fix: keyed by name alone. */
function oldRow() {
  return [
    { name: 'Re_ _EXTERNAL_ Claim.eml', role: 'original', size: 999, path: `${FOLDER}/Re_ _EXTERNAL_ Claim.eml` },
    ...parsed.attachments.map((a) => ({
      name: a.filename,
      contentType: a.contentType,
      size: a.bytes.length,
      role: 'attachment',
      path: `${FOLDER}/${storageKey(a.filename)}`,
    })),
  ];
}

test('the fixture reproduces the collision', () => {
  assert.deepEqual([...collidingPaths(oldRow())].sort(), [
    `${FOLDER}/Outlook-Please con.png`,
    `${FOLDER}/image.png`,
  ]);
  assert.equal(hasRealLoss(oldRow()), true, 'the two image.png differ in size');
});

test('same-size repeats alone are not a real loss', () => {
  const logosOnly = oldRow().filter((f) => f.name !== 'image.png');
  assert.equal(hasRealLoss(logosOnly), false);
});

test('every colliding entry gets its own path and its own bytes back', () => {
  const plan = planAttachmentRepair(oldRow(), parsed);
  assert.equal(plan.ok, true, plan.reason);

  const paths = plan.attachments.map((f) => f.path);
  assert.equal(new Set(paths).size, paths.length, paths.join('\n'));

  // Each repointed entry's upload is the bytes of ITS part, by position.
  const bytesAt = new Map(plan.uploads.map((u) => [u.path, Buffer.from(u.bytes).toString()]));
  const images = plan.attachments.filter((f) => f.name === 'image.png');
  assert.deepEqual(images.map((f) => bytesAt.get(f.path)), ['screenshot one', 'screenshot two!']);
  assert.deepEqual(images.map((f) => f.path), [`${FOLDER}/1/image.png`, `${FOLDER}/2/image.png`]);
});

test('only colliding entries move; names, sizes, order and the rest stay put', () => {
  const before = oldRow();
  const plan = planAttachmentRepair(before, parsed);

  assert.deepEqual(plan.attachments.map((f) => f.name), before.map((f) => f.name));
  assert.deepEqual(plan.attachments.map((f) => f.size), before.map((f) => f.size));
  // The original and the uniquely named PDF were never broken.
  assert.equal(plan.attachments[0].path, before[0].path);
  assert.equal(plan.attachments[3].path, `${FOLDER}/report.pdf`);
  assert.equal(plan.uploads.length, 4, 'two image.png + two Outlook logos, not the pdf');
  // And the input row is not mutated.
  assert.deepEqual(before, oldRow());
});

test('a row that no longer matches its .eml is refused, not guessed at', () => {
  const renamed = oldRow();
  renamed[2] = { ...renamed[2], name: 'something else.png' };
  const res = planAttachmentRepair(renamed, parsed);
  assert.equal(res.ok, false);
  assert.match(res.reason, /does not match/);

  const resized = oldRow();
  resized[1] = { ...resized[1], size: resized[1].size + 1 };
  assert.equal(planAttachmentRepair(resized, parsed).ok, false);

  const short = oldRow().slice(0, -1);
  assert.match(planAttachmentRepair(short, parsed).reason, /parses to 5/);
});

test('an overwritten original, or none at all, is refused', () => {
  const noOriginal = oldRow().filter((f) => f.role !== 'original');
  assert.match(planAttachmentRepair(noOriginal, parsed).reason, /no stored original/);

  const clobbered = oldRow();
  clobbered[3] = { ...clobbered[3], path: clobbered[0].path };
  assert.match(planAttachmentRepair(clobbered, parsed).reason, /itself overwritten/);
});

test('a row with nothing shared is left alone', () => {
  const fixed = planAttachmentRepair(oldRow(), parsed).attachments;
  assert.equal(planAttachmentRepair(fixed, parsed).ok, false, 'running twice is a no-op');
});
