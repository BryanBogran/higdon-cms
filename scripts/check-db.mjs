#!/usr/bin/env node
/**
 * Is the database actually there, and is it shaped the way the app expects?
 *
 *   node --env-file=.env.local scripts/check-db.mjs
 *
 * Uses the PUBLISHABLE key — the same one the browser has — on purpose. That
 * makes this two checks in one: whether the schema is present, and whether an
 * anonymous caller can read anything. A row coming back here is a data breach,
 * not a passing test.
 *
 * Keys are never printed. Only the project ref (the subdomain) is shown, which
 * is public anyway since it is in every request the browser makes.
 *
 * Exit code is the number of failures, so CI can gate on it.
 */

import { normalizeSupabaseUrl } from '../lib/supabase/url.js';

const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL || '');
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';

if (!url || !key) {
  console.error('No NEXT_PUBLIC_SUPABASE_URL / _PUBLISHABLE_KEY in the environment.');
  console.error('Run with:  node --env-file=.env.local scripts/check-db.mjs');
  process.exit(1);
}

const ref = url.replace(/^https?:\/\//, '').split('.')[0];
console.log(`Project: ${ref}\n`);

let failures = 0;
const pass = (m) => console.log(`  \x1b[32mok\x1b[0m    ${m}`);
const fail = (m) => { failures++; console.log(`  \x1b[31mFAIL\x1b[0m  ${m}`); };
const warn = (m) => console.log(`  \x1b[33mwarn\x1b[0m  ${m}`);

async function get(path) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, authorization: `Bearer ${key}` },
  });
  let body = null;
  try { body = await res.json(); } catch { /* empty body is fine */ }
  return { status: res.status, body };
}

/**
 * Probe one table by asking for specific columns.
 *
 * The three answers that matter:
 *   200 []        table exists, anon sees nothing        -> correct
 *   200 [rows]    anon can READ CASE DATA                -> breach
 *   404 PGRST205  table is not there                     -> migration not run
 *   400 42703     table is there, the column is not      -> migration partial
 */
async function probe(table, columns, source = 'supabase/schema.sql') {
  const { status, body } = await get(`${table}?select=${columns.join(',')}&limit=1`);

  // `source` names the file that creates this table, because "run
  // schema.sql" is the wrong instruction for anything added by a later
  // migration -- and a remediation that does not fix the problem wastes
  // more time than no remediation at all.
  if (status === 404 || body?.code === 'PGRST205' || body?.code === '42P01') {
    fail(`${table} — table does not exist (run ${source})`);
    return false;
  }
  if (body?.code === '42703') {
    const missing = /column "?([a-z_.]+)"? does not exist/i.exec(body.message || '');
    fail(`${table} — missing column ${missing ? missing[1] : ''} (run ${source})`);
    return false;
  }
  if (status === 200 && Array.isArray(body) && body.length > 0) {
    fail(`${table} — ANONYMOUS READ RETURNED ${body.length} ROW(S). RLS is off or permissive.`);
    return false;
  }
  if (status === 200) {
    pass(`${table} — present, and anon reads nothing`);
    return true;
  }
  if (status === 401 || status === 403) {
    pass(`${table} — present, anon refused (${body?.code || status})`);
    return true;
  }
  fail(`${table} — unexpected ${status} ${body?.code || ''} ${body?.message || ''}`);
  return false;
}

console.log('Core schema (supabase/schema.sql)');
await probe('matter', ['id', 'client_name', 'case_number', 'sol', 'doa', 'trial_date', 'phase', 'status', 'deleted_at']);
await probe('matter_checklist_item', ['matter_id', 'field_key', 'done', 'occurred_on']);
await probe('activity', ['id', 'kind', 'body', 'source', 'rule_key', 'due_date', 'assigned_to']);
await probe('matter_section_data', ['matter_id', 'section_key', 'fields']);
await probe('matter_section_row', ['id', 'matter_id', 'section_key', 'ordinal', 'data']);
await probe('profile', ['id', 'handle', 'display_name']);
await probe('case_number_counter', ['year_yy', 'last_seq']);
await probe('audit_event', ['id']);

console.log('\nEmail migration (supabase/003_email.sql)');
const EMAIL_SQL = 'supabase/003_email.sql';
const emailCols = await probe('activity', ['id', 'meta', 'subject', 'dedupe_key'], EMAIL_SQL);
const intake = await probe('matter', ['id', 'intake_slug'], EMAIL_SQL);
if (!emailCols || !intake) {
  warn('003_email.sql has not been run — email filing will fail until it is');
}

console.log('\nDocuments + Related Cases (004, 005)');
const DOCS_SQL = 'supabase/004_documents.sql';
const docTable = await probe('document', ['id', 'matter_id', 'provider', 'external_id', 'name', 'trashed'], DOCS_SQL);
const reviewTable = await probe('drive_folder_review', ['folder_id', 'folder_name', 'candidates'], DOCS_SQL);
if (!docTable || !reviewTable) warn('004_documents.sql has not been run — the Docs tab will be empty');
const relTable = await probe('matter_relation', ['id', 'from_id', 'to_id', 'kind'], 'supabase/005_sections.sql');
if (!relTable) warn('005_sections.sql has not been run — Related Cases cannot save');

console.log('\nWrite protection');
{
  // Anon must not be able to create a matter. A 201 here is the whole farm.
  const res = await fetch(`${url}/rest/v1/matter`, {
    method: 'POST',
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: '__rls_probe__' }),
  });
  if (res.status === 201) {
    fail('anon INSERT on matter SUCCEEDED — RLS is not protecting writes');
  } else {
    const b = await res.json().catch(() => ({}));
    pass(`anon INSERT on matter refused (${b.code || res.status})`);
  }
}
{
  // An always-true DELETE. Must affect zero rows.
  const res = await fetch(`${url}/rest/v1/matter?client_name=neq.__never__`, {
    method: 'DELETE',
    headers: { apikey: key, authorization: `Bearer ${key}`, prefer: 'return=representation' },
  });
  const b = await res.json().catch(() => []);
  if (res.status < 300 && Array.isArray(b) && b.length > 0) {
    fail(`anon DELETE removed ${b.length} row(s)`);
  } else {
    pass(`anon DELETE affected nothing (${b.code || res.status})`);
  }
}

console.log('\nStorage');
{
  /*
   * Bucket existence is probed with an UPLOAD ATTEMPT, not a list or a
   * metadata read. Both of those return the same answer for "the bucket is
   * not there" and "you may not look at it", so neither can tell the two
   * apart from an anonymous key -- an earlier version of this script used
   * `object/list` and reported a passing check for a bucket that did not
   * exist. The upload is refused either way; only the ERROR differs:
   *
   *   403 AccessDenied / row-level security   bucket exists, anon refused
   *   404 NoSuchBucket                        bucket is not there
   */
  const res = await fetch(`${url}/storage/v1/object/case-files/__rls_probe__.txt`, {
    method: 'POST',
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'text/plain' },
    body: 'probe',
  });
  const b = await res.json().catch(() => ({}));

  if (b.code === 'NoSuchBucket') {
    fail('case-files bucket does not exist (run supabase/003_email.sql)');
  } else if (res.status < 300) {
    fail('ANONYMOUS UPLOAD SUCCEEDED — the case-files bucket is writable by anyone');
  } else if (b.code === 'AccessDenied' || res.status === 403 || /row-level security/i.test(b.message || '')) {
    pass('case-files — bucket exists, anon writes refused');
  } else {
    fail(`case-files — unexpected ${res.status} ${b.code || ''} ${b.message || ''}`);
  }
}

/* ------------------------------------------------------------------ *
 * NEGATIVE CONTROLS
 *
 * These exist because the first version of this script passed every
 * check while one of them was incapable of failing. A health check that
 * cannot detect a broken database is worse than no health check: it
 * converts "we do not know" into "we verified it".
 *
 * So the script now proves its own probes discriminate, by pointing them
 * at things that are definitely absent. If these do not fail, nothing
 * above them means anything.
 * ------------------------------------------------------------------ */
console.log('\nNegative controls (these must all report "missing")');
{
  const t = await get('no_such_table_xyz?select=id&limit=1');
  if (t.body?.code === 'PGRST205' || t.status === 404) pass('a missing table is detected');
  else fail(`table probe is broken — a nonexistent table returned ${t.status}`);

  const c = await get('matter?select=no_such_column_xyz&limit=1');
  if (c.body?.code === '42703') pass('a missing column is detected');
  else fail(`column probe is broken — a nonexistent column returned ${c.status}`);

  const s = await fetch(`${url}/storage/v1/object/no-such-bucket-xyz/__probe__.txt`, {
    method: 'POST',
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'text/plain' },
    body: 'probe',
  });
  const sb = await s.json().catch(() => ({}));
  if (sb.code === 'NoSuchBucket') pass('a missing bucket is detected');
  else fail(`bucket probe is broken — a nonexistent bucket returned ${s.status} ${sb.code || ''}`);
}

console.log(
  failures === 0
    ? '\n\x1b[32mAll checks passed.\x1b[0m'
    : `\n\x1b[31m${failures} check(s) failed.\x1b[0m`
);
process.exit(failures);
