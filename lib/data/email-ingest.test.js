import test from 'node:test';
import assert from 'node:assert/strict';

import { parseEml } from '@/lib/domain/email';
import { uploadEmailFiles } from './email-ingest.js';

/** CRLF, because that is what a real .eml uses and LF-only hides bugs. */
const eml = (s) => s.replace(/\n/g, '\r\n');

/** An inline part, the way Outlook attaches a signature logo. */
const part = (name, body) => `--b
Content-Type: image/png; name="${name}"
Content-Disposition: inline; filename="${name}"
Content-Transfer-Encoding: base64

${Buffer.from(body).toString('base64')}
`;

// The real shape: three signature images, two of them called image.png.
const SIGNATURE_EML = eml(`Message-ID: <sig@adjuster.example>
Date: Tue, 22 Sep 2026 10:00:00 -0500
From: "Adjuster" <adj@carrier.example>
To: intake@higdonlawyers.com
Subject: Re: [EXTERNAL] Claim 4471
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="b"

--b
Content-Type: text/plain

See attached.
${part('image.png', 'first logo')}${part('image.png', 'second logo')}${part('Outlook-Please con.png', 'banner')}--b--
`);

/** Just enough of the Supabase client to record what was stored where. */
function fakeStorage() {
  const objects = new Map();
  const uploads = [];
  const db = {
    storage: {
      from: () => ({
        async upload(path, blob) {
          uploads.push(path);
          objects.set(path, Buffer.from(await blob.arrayBuffer()).toString());
          return { error: null };
        },
      }),
    },
  };
  return { db, objects, uploads };
}

test('same-named attachments in one email are stored at different paths', async () => {
  const bytes = new TextEncoder().encode(SIGNATURE_EML);
  const parsed = parseEml(bytes);
  assert.equal(parsed.attachments.length, 3, 'fixture should parse to three attachments');

  const { db, objects, uploads } = fakeStorage();
  const res = await uploadEmailFiles(db, { matterId: 'm1', parsed, bytes });
  assert.equal(res.ok, true);

  const paths = res.attachments.map((a) => a.path);
  assert.equal(new Set(paths).size, paths.length, paths.join('\n'));
  assert.equal(new Set(uploads).size, uploads.length, 'no path may be uploaded twice');

  // Every row opens its OWN bytes -- the thing that was actually broken.
  const files = res.attachments.filter((a) => a.role === 'attachment');
  assert.deepEqual(
    files.map((a) => objects.get(a.path)),
    ['first logo', 'second logo', 'banner']
  );
});

test('display names are unchanged; only the path is indexed', async () => {
  const bytes = new TextEncoder().encode(SIGNATURE_EML);
  const { db } = fakeStorage();
  const res = await uploadEmailFiles(db, { matterId: 'm1', parsed: parseEml(bytes), bytes });

  const files = res.attachments.filter((a) => a.role === 'attachment');
  assert.deepEqual(files.map((a) => a.name), ['image.png', 'image.png', 'Outlook-Please con.png']);
  assert.ok(files.every((a) => a.path.startsWith('m1/email/sig@adjuster.example/')));

  // The original keeps its unindexed path, beside the numbered folders.
  const original = res.attachments.find((a) => a.role === 'original');
  assert.equal(original.path, 'm1/email/sig@adjuster.example/Re_ _EXTERNAL_ Claim 4471.eml');
});
