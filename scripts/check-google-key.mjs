#!/usr/bin/env node
/**
 * Diagnose GOOGLE_PRIVATE_KEY without ever printing it.
 *
 *   node --env-file=.env.local scripts/check-google-key.mjs
 *
 * Exists because OpenSSL's answer to a mangled key is
 * `error:1E08010C:DECODER routines::unsupported`, which names neither the
 * problem nor the fix.
 */

import { inspectPrivateKey } from '../lib/google/private-key.js';

const i = inspectPrivateKey(process.env.GOOGLE_PRIVATE_KEY);
const yes = (b) => (b ? 'yes' : 'no');

console.log('GOOGLE_PRIVATE_KEY');
console.log(`  present ............... ${yes(i.present)}`);
console.log(`  length ................ ${i.rawLength} chars`);
console.log(`  wrapped in quotes ..... ${yes(i.wrappedInQuotes)}   (handled either way)`);
console.log(`  escaped \\n ............ ${yes(i.hadEscapedNewlines)}`);
console.log(`  real newlines ......... ${yes(i.hadRealNewlines)}`);
console.log(`  lines after unescape .. ${i.lines}   (a real key is ~28)`);
console.log(`  header ................ ${i.header}`);
console.log(`  footer ................ ${i.footer}`);
console.log('');

if (i.valid) {
  console.log('\x1b[32mThe key parses. Signing will work.\x1b[0m');
} else {
  console.log(`\x1b[31mThe key does not parse.\x1b[0m\n\n  ${i.problem}\n`);
  console.log('The value you want is the `private_key` field of the service-account');
  console.log('JSON file — the long one starting "-----BEGIN PRIVATE KEY-----".');
}

for (const k of ['GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_DRIVE_ROOT_FOLDER_ID', 'GOOGLE_IMPERSONATE_USER']) {
  const v = process.env[k] || '';
  const note =
    k === 'GOOGLE_IMPERSONATE_USER' && !v ? '(empty — correct for read-only indexing)' : '';
  console.log(`${k.padEnd(30)} ${v ? `set (${v.length} chars)` : 'empty'} ${note}`);
}

process.exit(i.valid ? 0 : 1);
