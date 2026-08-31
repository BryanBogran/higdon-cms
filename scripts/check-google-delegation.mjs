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
import {
  diagnoseDelegation, NEEDED_SCOPE, CANDIDATE_SCOPES,
} from '../lib/google/delegation-diagnosis.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = NEEDED_SCOPE;

const args = process.argv.slice(2);
const keyPath = args.find((a) => !a.includes('@')) || '';
const impersonate = args.find((a) => a.includes('@')) || process.env.GOOGLE_IMPERSONATE_USER || '';

/*
 * The JSON file is the easy path, but it is often long gone by the time
 * something breaks. The env vars are enough for every test here -- only the
 * printed Client ID needs the file, because client_id is not derivable from a
 * private key and is not in the environment.
 */
let key;
if (keyPath) {
  try {
    key = JSON.parse(readFileSync(keyPath, 'utf8'));
  } catch (err) {
    console.log(`Could not read ${keyPath}\n  ${err.message}`);
    process.exit(1);
  }
} else if (process.env.GOOGLE_PRIVATE_KEY && process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) {
  key = {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n').replace(/^"|"$/g, ''),
    client_id: '',
  };
} else {
  console.log(`
Usage:
  node scripts/check-google-delegation.mjs <service-account.json> [user@higdonlawyers.com]

or, with the same variables the app uses:
  node --env-file=.env.local scripts/check-google-delegation.mjs files@higdonlawyers.com

The JSON file is the one downloaded when the service-account key was created.
It is the only source of the numeric Client ID -- that value is not in the
environment and cannot be derived from the key. Without it this still tests
delegation and reports which scopes are authorised; you would read the Client
ID from Cloud Console -> IAM & Admin -> Service Accounts -> Details -> Unique ID.
`);
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

async function token({ sub, scope = SCOPE }) {
  const iat = Math.floor(Date.now() / 1000);
  const claims = {
    iss: key.client_email,
    scope,
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

// Probe each scope alone, but only when it can tell us something: if the key
// itself is failing, or delegation already works, there is nothing to narrow.
let granted = [];
if (asSelf.ok && impersonate && !asUser.ok) {
  console.log(bold('Which scopes does the entry actually grant?\n'));
  for (const scope of CANDIDATE_SCOPES) {
    const r = await token({ sub: impersonate, scope });
    if (r.ok) granted.push(scope);
    console.log(`  ${r.ok ? green('granted ') : red('refused ')} ${scope}`);
  }
  console.log('');
}

const d = diagnoseDelegation({
  asSelfOk: asSelf.ok,
  impersonate,
  asUserOk: Boolean(asUser?.ok),
  granted,
});

console.log((d.ok ? green : red)(d.headline) + '\n');

if (d.verdict === 'key-broken') {
  console.log('Nothing you change in the Admin console will help. Check that the key');
  console.log('still exists on the service account, and that this machine\'s clock is');
  console.log('correct — a JWT signed more than a few minutes out of step is rejected.\n');
  process.exit(1);
}

if (d.verdict === 'not-tested') {
  console.log('Re-run with the address to test delegation:\n');
  console.log(`  node scripts/check-google-delegation.mjs ${keyPath || '<key.json>'} files@higdonlawyers.com\n`);
  process.exit(0);
}

if (d.verdict === 'ok') {
  console.log(green('Set GOOGLE_IMPERSONATE_USER to that address in Vercel and redeploy —'));
  console.log(green('an env change does not apply to a build that already exists.\n'));
  process.exit(0);
}

if (d.verdict === 'no-scopes') {
  console.log('A wrong scope string would still leave the other scopes working, so the');
  console.log('scope is not what is wrong here. Check, in this order:\n');
  console.log(`  1. The Client ID on the entry. It must be ${bold(key.client_id || 'the Unique ID from Cloud Console')}`);
  console.log('     and NOT the OAuth id ending .apps.googleusercontent.com.');
  console.log(`  2. That you saved it in the Workspace domain that owns ${impersonate}.`);
  console.log('     Being an admin of another domain lets you save an entry that can');
  console.log('     never apply.');
  console.log('  3. Propagation. Usually minutes. Re-run this before changing anything —');
  console.log('     most of the time lost here goes on editing a config already correct.\n');
  process.exit(1);
}

// wrong-scopes
console.log(`  needed:  ${bold(d.needed)}`);
console.log(`  granted: ${d.granted.join('\n           ')}\n`);
console.log('EDIT that existing entry and replace its scopes. Do not add a second one —');
console.log('delegation matches on client id, so a new row for the same id does not add');
console.log('scopes to it.\n');
console.log(`${bold('drive.file')} is the usual culprit: it only ever covers files the app itself`);
console.log('created, so it cannot see folders your staff made.\n');
process.exit(1);
