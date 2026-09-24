#!/usr/bin/env node
/**
 * Give back the email attachments that overwrote each other.
 *
 * Before 2026-09-24 a message with two `image.png` stored both at one key
 * and kept only the last. This re-reads each affected email's stored
 * original .eml, uploads every colliding attachment to its own indexed key
 * (the scheme ingest uses now), and repoints just those entries on the row.
 * See lib/domain/email-repair.js for the matching rules.
 *
 *   DRY RUN (default -- reads only, changes nothing):
 *     node --env-file=.env.local scripts/repair-email-attachments.mjs
 *
 *   ONE EMAIL, for real, to check it before the rest:
 *     node --env-file=.env.local scripts/repair-email-attachments.mjs --apply --activity <id>
 *
 *   EVERYTHING, for real:
 *     node --env-file=.env.local scripts/repair-email-attachments.mjs --apply
 *
 * Flags:
 *   --apply              write. Without it nothing is uploaded or updated.
 *   --activity <id>      only this row. Repeatable, or comma-separated.
 *   --include-identical  also repair rows where every colliding copy has the
 *                        same size (a logo repeated). Off by default: those
 *                        open the right image already.
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY (storage and every matter, past RLS).
 * Keys are never printed.
 *
 * Safe to re-run. A repaired row has no shared paths, so it is skipped; a
 * row interrupted halfway re-uploads the same bytes to the same keys. Old
 * objects are NOT deleted, and `activity` is audited, so the previous
 * attachments list is in audit_event if this ever has to be undone.
 */

import { createClient } from '@supabase/supabase-js';
import { normalizeSupabaseUrl } from '../lib/supabase/url.js';
import { parseEml } from '../lib/domain/email.js';
import { collidingPaths, hasRealLoss, planAttachmentRepair } from '../lib/domain/email-repair.js';

const BUCKET = 'case-files';

/* ---------------- arguments ---------------- */

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const INCLUDE_IDENTICAL = argv.includes('--include-identical');
const ONLY = argv
  .flatMap((a, i) => (a === '--activity' ? String(argv[i + 1] || '').split(',') : []))
  .map((s) => s.trim())
  .filter(Boolean);

const known = new Set(['--apply', '--include-identical', '--activity']);
const unknown = argv.filter((a, i) => a.startsWith('--') && !known.has(a) && argv[i - 1] !== '--activity');
if (unknown.length || (argv.includes('--activity') && !ONLY.length)) {
  console.error(`Unrecognised: ${unknown.join(' ') || '--activity needs an id'}`);
  process.exit(2);
}

/* ---------------- client ---------------- */

const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL || '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!url || !key) {
  console.error('Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.');
  console.error('Run with:  node --env-file=.env.local scripts/repair-email-attachments.mjs');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

console.log(`Project: ${url.replace(/^https?:\/\//, '').split('.')[0]}`);
console.log(APPLY ? 'Mode:    APPLY -- uploading and updating rows\n' : 'Mode:    dry run -- nothing will be changed\n');

/* ---------------- find the rows ---------------- */

const COLUMNS = 'id, matter_id, created_at, attachments, matter:matter_id(case_number, client_name)';

async function candidates() {
  if (ONLY.length) {
    const { data, error } = await db.from('activity').select(COLUMNS).in('id', ONLY);
    if (error) throw new Error(error.message);
    const missing = ONLY.filter((id) => !data.some((r) => r.id === id));
    if (missing.length) console.log(`Not found: ${missing.join(', ')}\n`);
    return data;
  }
  const rows = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await db
      .from('activity')
      .select(COLUMNS)
      .eq('kind', 'email')
      .order('created_at', { ascending: true })
      .range(from, from + 499);
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < 500) break;
  }
  return rows;
}

/* ---------------- repair one ---------------- */

async function repair(row) {
  const original = row.attachments.find((f) => f?.role === 'original');
  if (!original?.path) return { ok: false, reason: 'no stored original .eml to recover from' };

  const dl = await db.storage.from(BUCKET).download(original.path);
  if (dl.error) return { ok: false, reason: `could not download the original: ${dl.error.message}` };

  let parsed;
  try {
    parsed = parseEml(new Uint8Array(await dl.data.arrayBuffer()));
  } catch (err) {
    return { ok: false, reason: `could not parse the original: ${err?.message || err}` };
  }

  const plan = planAttachmentRepair(row.attachments, parsed);
  if (!plan.ok || !APPLY) return plan;

  // Files first, row last -- the same order as ingest, for the same reason:
  // a row pointing at keys that were never written is the worse failure.
  for (const u of plan.uploads) {
    const up = await db.storage
      .from(BUCKET)
      .upload(u.path, new Blob([u.bytes], { type: u.contentType }), { upsert: true });
    if (up.error) return { ok: false, reason: `upload failed for ${u.path}: ${up.error.message}` };
  }

  // Refuse if the row moved under us since it was read.
  const { data: now, error: readErr } = await db.from('activity').select('attachments').eq('id', row.id).single();
  if (readErr) return { ok: false, reason: `could not re-read the row: ${readErr.message}` };
  if (JSON.stringify(now.attachments) !== JSON.stringify(row.attachments)) {
    return { ok: false, reason: 'the row changed while this ran -- re-run to pick it up' };
  }

  const { error } = await db.from('activity').update({ attachments: plan.attachments }).eq('id', row.id);
  if (error) return { ok: false, reason: `files uploaded, but the row update failed: ${error.message}` };
  return plan;
}

/* ---------------- run ---------------- */

const all = await candidates();
const affected = all.filter((r) => Array.isArray(r.attachments) && collidingPaths(r.attachments).size);
const todo = affected.filter((r) => INCLUDE_IDENTICAL || ONLY.length || hasRealLoss(r.attachments));

console.log(`${all.length} email rows read, ${affected.length} with shared paths, ${todo.length} to repair.`);
if (affected.length > todo.length) {
  console.log(`${affected.length - todo.length} skipped: every shared copy is the same size (--include-identical to include).`);
}
console.log('');

let repaired = 0;
let files = 0;
const refused = [];

for (const row of todo) {
  const who = `${row.matter?.case_number || '?'} ${row.matter?.client_name || ''}`.trim();
  const res = await repair(row);
  if (!res.ok) {
    refused.push({ row, who, reason: res.reason });
    console.log(`  \x1b[31mSKIP\x1b[0m  ${who}  ${row.id}\n        ${res.reason}`);
    continue;
  }
  repaired++;
  files += res.uploads.length;
  const verb = APPLY ? 'repaired' : 'would repair';
  console.log(`  \x1b[32m${APPLY ? 'done' : 'ok'}\x1b[0m    ${who}  ${row.id}  (${verb} ${res.uploads.length})`);
  for (const u of res.uploads) {
    console.log(`        ${u.bytes.length.toString().padStart(8)} B  ${u.path.split('/').slice(-2).join('/')}`);
  }
}

console.log(
  `\n${APPLY ? 'Repaired' : 'Would repair'} ${files} attachments on ${repaired} emails.` +
    (refused.length ? ` ${refused.length} refused -- see SKIP lines above; those rows were not touched.` : '')
);
if (!APPLY && repaired) console.log('Nothing was changed. Re-run with --apply to write.');
process.exit(refused.length ? 1 : 0);
