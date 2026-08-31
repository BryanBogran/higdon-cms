#!/usr/bin/env node
/**
 * Find the values domain-wide delegation needs, and say which half is broken.
 *
 *   node scripts/check-google-delegation.mjs ~/Downloads/service-account.json files@higdonlawyers.com
 *
 * Google's answer to a delegation problem is `unauthorized_client`, which has
 * four different causes and names none of them. This separates them by asking
 * for a token TWICE:
 *
 *   without `sub`  the service account as itself. Proves the key, the client
 *                  email and the clock are fine. Nothing to do with the Admin
 *                  console.
 *   with `sub`     the service account acting as a person. This is the part
 *                  the Admin console authorises.
 *
 * First succeeds, second fails  -> delegation. The Admin console entry is
 *                                  missing, has the wrong client id, has the
 *                                  wrong scope, or has not propagated.
 * Both fail                     -> the key or the service account, not
 *                                  delegation. Nothing in the Admin console
 *                                  will fix it.
 *
 * Reads the JSON key file directly, so it needs no environment at all. The
 * file is never printed and neither is the key.
 */

import { readFileSync } from 'node:fs';
import { createSign, createPrivateKey } from 'node:crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/drive';

const [, , keyPath, impersonate] = process.argv;

if (!keyPath) {
  console.log(`
Usage:
  node scripts/check-google-delegation.mjs <service-account.json> [user@higdonlawyers.com]

The JSON file is the one downloaded when the service account key was created.
If you no longer have it, create a new key: Google Cloud Console -> IAM & Admin
-> Service Accounts -> your account -> Keys -> Add key -> JSON.
`);
  process.exit(1);
}

let key;
try {
  key = JSON.parse(readFileSync(keyPath, 'utf8'));
} catch (err) {
  console.log(`Could not read ${keyPath}\n  ${err.message}`);
  process.exit(1);
}

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

/* ------------------------------------------------------------------ *
 * The two values the Admin console asks for
 * ------------------------------------------------------------------ */

console.log(`\n${bold('Paste these into Admin console → Security → Access and data control →')}`);
console.log(`${bold('API controls → Domain-wide delegation → Add new')}\n`);
console.log(`  Client ID      ${bold(key.client_id || '(missing from the JSON)')}`);
console.log(`  OAuth scopes   ${bold(SCOPE)}\n`);
console.log(`  (service account: ${key.client_email || '(missing)'})\n`);

if (key.client_id && !/^\d+$/.test(key.client_id)) {
  console.log(red('  The client id is not all digits. Domain-wide delegation wants the bare'));
  console.log(red('  number, not the OAuth id ending in .apps.googleusercontent.com.\n'));
}

/* ------------------------------------------------------------------ *
 * Ask for a token, twice
 * ------------------------------------------------------------------ */

const b64url = (input) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function token({ sub }) {
  const iat = Math.floor(Date.now() / 1000);
  const claims = {
    iss: key.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat,
    exp: iat + 3600,
    ...(sub ? { sub } : {}),
  };
  const unsigned =
    `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claims))}`;

  let signature;
  try {
    signature = createSign('RSA-SHA256')
      .update(unsigned)
      .sign(createPrivateKey(key.private_key));
  } catch (err) {
    return { ok: false, error: `could not sign: ${err.message}` };
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${b64url(signature)}`,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok && body.access_token) return { ok: true };
  return { ok: false, error: body.error || `HTTP ${res.status}`, detail: body.error_description || '' };
}

console.log(bold('Testing\n'));

const asSelf = await token({});
console.log(`  as the service account ....... ${asSelf.ok ? green('ok') : red(asSelf.error)}`);

let asUser = null;
if (impersonate) {
  asUser = await token({ sub: impersonate });
  console.log(`  acting as ${impersonate} ... ${asUser.ok ? green('ok') : red(asUser.error)}`);
  if (asUser.detail) console.log(`    ${asUser.detail}`);
} else {
  console.log('  acting as a user ............. skipped (pass the address as the 2nd argument)');
}

/* ------------------------------------------------------------------ *
 * Say which half is broken
 * ------------------------------------------------------------------ */

console.log('');

if (!asSelf.ok) {
  console.log(red('The key itself is not working, so this is not a delegation problem.'));
  console.log('Nothing you change in the Admin console will help. Check that the JSON');
  console.log('file matches a key that still exists on the service account, and that');
  console.log("this machine's clock is correct — a JWT signed more than a few minutes");
  console.log('out of step is rejected.\n');
  process.exit(1);
}

if (!impersonate) {
  console.log('The key works. Re-run with the address to test delegation:\n');
  console.log(`  node scripts/check-google-delegation.mjs ${keyPath} files@higdonlawyers.com\n`);
  process.exit(0);
}

if (asUser.ok) {
  console.log(green('Delegation is authorised. Set GOOGLE_IMPERSONATE_USER to that address'));
  console.log(green('in Vercel and redeploy — env changes do not apply to an existing build.\n'));
  process.exit(0);
}

console.log(red('The key works but delegation does not. It is the Admin console entry.\n'));
console.log('In order of how often each one is the cause:\n');
console.log(`  1. The scope does not match character for character. It must be exactly`);
console.log(`     ${bold(SCOPE)}`);
console.log(`     Not drive.file, not drive.readonly, no trailing space, no quotes.`);
console.log(`  2. The client id does not match. It must be ${bold(key.client_id)}`);
console.log(`     If an older entry exists for this account, EDIT it. A second entry for`);
console.log(`     the same client id does not add scopes — delegation matches on id.`);
console.log(`  3. Not propagated yet. Usually a few minutes; Google says up to 24 hours.`);
console.log(`     Wait five and re-run this before changing anything.`);
console.log(`  4. ${impersonate} is not a real user in the domain, or is suspended.`);
console.log(`     It must be a live Workspace account, not an alias or a group.\n`);
process.exit(1);
