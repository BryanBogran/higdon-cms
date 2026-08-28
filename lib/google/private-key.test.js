import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';

import {
  normalizePrivateKey, validatePrivateKey, describeKeyProblem, inspectPrivateKey,
} from './private-key.js';

/**
 * A real PKCS#8 key, generated per run rather than committed. Shorter than
 * Google's 2048-bit for speed; the encoding is what is under test, not the
 * modulus size.
 */
const { privateKey: PEM } = generateKeyPairSync('rsa', {
  modulusLength: 1024,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const ok = (raw) => validatePrivateKey(raw).ok;

test('a clean multi-line PEM works', () => {
  assert.ok(ok(PEM));
});

test('literal \\n, exactly as it appears in the JSON key file', () => {
  // The overwhelmingly common case: the value is copied out of the JSON,
  // where newlines are escaped.
  assert.ok(ok(PEM.replace(/\n/g, '\\n')));
});

test('literal \\n WITH the surrounding quotes copied too', () => {
  // What you get pasting straight from the JSON including its quotes, which
  // a dashboard field will happily accept verbatim.
  assert.ok(ok(`"${PEM.replace(/\n/g, '\\n')}"`));
  assert.ok(ok(`'${PEM.replace(/\n/g, '\\n')}'`));
});

test('double-escaped, as a shell or CI pipeline leaves it', () => {
  assert.ok(ok(PEM.replace(/\n/g, '\\\\n')));
});

test('Windows line endings', () => {
  assert.ok(ok(PEM.replace(/\n/g, '\r\n')));
});

test('the whole PEM base64-encoded', () => {
  assert.ok(ok(Buffer.from(PEM).toString('base64')));
});

test('a missing trailing newline is added — OpenSSL insists on it', () => {
  assert.ok(ok(PEM.trimEnd()));
  assert.ok(normalizePrivateKey(PEM.trimEnd()).endsWith('\n'));
});

test('surrounding whitespace does not matter', () => {
  assert.ok(ok(`\n\n   ${PEM}   \n`));
});

/* ------------------------------------------------------------------ *
 * Failures name the cause, because OpenSSL will not
 * ------------------------------------------------------------------ */

test('empty is reported as empty, not as a decode failure', () => {
  assert.equal(validatePrivateKey('').error, 'GOOGLE_PRIVATE_KEY is empty.');
  assert.equal(validatePrivateKey(null).ok, false);
  assert.equal(validatePrivateKey(undefined).ok, false);
});

test('copying private_key_id instead of private_key is called out by name', () => {
  // Adjacent fields in the JSON, one short hex string and one long PEM.
  const r = validatePrivateKey('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2');
  assert.equal(r.ok, false);
  assert.match(r.error, /private_key_id/);
});

test('a PKCS#1 key is identified as the wrong format', () => {
  const { privateKey: pkcs1 } = generateKeyPairSync('rsa', {
    modulusLength: 1024,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  assert.match(describeKeyProblem(pkcs1), /PKCS#1/);
});

test('a truncated key says so rather than "unsupported"', () => {
  const cut = PEM.slice(0, PEM.length / 2);
  assert.match(describeKeyProblem(cut), /footer is missing|truncated/);
});

test('a key with its newlines stripped says exactly that', () => {
  const oneLine = PEM.replace(/\n/g, '');
  assert.match(describeKeyProblem(oneLine), /all on one line/);
});

test('an error message never contains the key material', () => {
  // These get logged, and a logged private key is a compromised private key.
  const r = validatePrivateKey(PEM.slice(0, 200));
  assert.equal(r.ok, false);
  const body = PEM.split('\n')[1];
  assert.ok(!r.error.includes(body), 'no base64 body in the message');
});

test('inspect describes the shape without revealing it', () => {
  const i = inspectPrivateKey(`"${PEM.replace(/\n/g, '\\n')}"`);
  assert.equal(i.valid, true);
  assert.equal(i.wrappedInQuotes, true);
  assert.equal(i.hadEscapedNewlines, true);
  assert.equal(i.header, '-----BEGIN PRIVATE KEY-----');
  assert.ok(i.lines > 3);
  assert.ok(!JSON.stringify(i).includes(PEM.split('\n')[1]));
});
