#!/usr/bin/env node
/**
 * Turn a Filevine HAR capture into a section/field inventory.
 *
 *   node scripts/analyze-har.mjs imports/filevine.har
 *
 * A HAR records every request the browser made, including response bodies. For
 * a single-page app like Filevine that means the real JSON behind every screen:
 * entity shapes, field keys, enum values, relationships.
 *
 * ── PRIVACY ─────────────────────────────────────────────────────────────
 * This reports STRUCTURE, never content. For every field it prints the key,
 * the inferred type, and how often it appears — not the value. The only values
 * echoed are short repeated strings that are evidently enum members (status,
 * phase, role), because those ARE the configuration and reconstructing them by
 * hand is where mistakes get made.
 *
 * Strings that look like names, emails, phones, or free text are counted and
 * shape-described, never printed. The HAR itself stays in /imports/, which is
 * gitignored; only this report is meant to be read or shared.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/analyze-har.mjs <path-to.har>');
  process.exit(1);
}

const har = JSON.parse(readFileSync(file, 'utf8'));
const entries = har?.log?.entries || [];

/* ---------------------------------------------------------------- *
 * Redaction
 * ---------------------------------------------------------------- */

const PII_KEY = /name|email|phone|address|ssn|dob|birth|client|contact|street|city|zip|notes?$|body|description|summary|comment/i;

// Identifiers are short strings but carry no configuration meaning, so
// sampling them just adds noise to the "likely options" column.
const ID_KEY = /^(id|guid|uuid|key|hash|token)$|(^|[a-z])Id$|_id$/;

const looksLikeEnum = (v) =>
  typeof v === 'string' &&
  v.length > 0 &&
  v.length <= 40 &&
  !/\d{3}/.test(v) &&
  !v.includes('@') &&
  !/https?:/.test(v);

function describe(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return value.length ? `array<${describe(value[0])}>` : 'array<empty>';
  if (typeof value === 'object') return 'object';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'decimal';
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return 'timestamp';
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'date';
    if (/^[0-9a-f-]{36}$/i.test(value)) return 'uuid';
    if (/^https?:\/\//.test(value)) return 'url';
    if (value.includes('@')) return 'email';
    if (value === '') return 'string(empty)';
    return `string(${value.length})`;
  }
  return typeof value;
}

/* ---------------------------------------------------------------- *
 * Walk every JSON response, collecting field shapes per endpoint
 * ---------------------------------------------------------------- */

const endpoints = new Map(); // path -> { count, fields: Map<key, {types:Set, seen, samples:Set}> }

function record(path, obj, prefix = '', depth = 0) {
  if (depth > 3 || !obj || typeof obj !== 'object') return;
  const ep = endpoints.get(path);

  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (!ep.fields.has(key)) ep.fields.set(key, { types: new Set(), seen: 0, samples: new Set() });
    const f = ep.fields.get(key);
    f.types.add(describe(v));
    f.seen++;

    // Collect candidate enum values only where the key is not PII-ish.
    if (looksLikeEnum(v) && !PII_KEY.test(k) && !ID_KEY.test(k) && f.samples.size < 12) f.samples.add(v);

    if (v && typeof v === 'object' && !Array.isArray(v)) record(path, v, key, depth + 1);
    if (Array.isArray(v) && v.length && typeof v[0] === 'object') record(path, v[0], key + '[]', depth + 1);
  }
}

let jsonResponses = 0;
for (const e of entries) {
  const url = e?.request?.url || '';
  const body = e?.response?.content?.text;
  if (!body) continue;
  const mime = e?.response?.content?.mimeType || '';
  if (!mime.includes('json')) continue;

  let parsed;
  try { parsed = JSON.parse(body); } catch { continue; }
  jsonResponses++;

  // Normalize the path: strip host, query, and any id-looking segment.
  let path;
  try {
    path = new URL(url).pathname
      .replace(/\/\d{4,}/g, '/{id}')
      .replace(/\/[0-9a-f-]{36}/gi, '/{uuid}');
  } catch { continue; }

  if (!endpoints.has(path)) endpoints.set(path, { count: 0, fields: new Map() });
  endpoints.get(path).count++;

  const rows = Array.isArray(parsed) ? parsed
    : Array.isArray(parsed?.items) ? parsed.items
    : Array.isArray(parsed?.data) ? parsed.data
    : [parsed];
  for (const row of rows.slice(0, 25)) record(path, row);
}

/* ---------------------------------------------------------------- *
 * Report
 * ---------------------------------------------------------------- */

const out = [];
out.push('# Filevine HAR inventory');
out.push('');
out.push(`Source: \`${file}\``);
out.push(`Requests in capture: ${entries.length} · JSON responses parsed: ${jsonResponses} · distinct endpoints: ${endpoints.size}`);
out.push('');
out.push('Structure only. Field VALUES are not printed — types and counts instead. The');
out.push('exception is short repeated strings on non-personal keys, which are almost');
out.push('certainly dropdown options and are the thing most worth capturing exactly.');
out.push('');

const sorted = [...endpoints.entries()].sort((a, b) => b[1].count - a[1].count);

for (const [path, ep] of sorted) {
  if (ep.fields.size === 0) continue;
  out.push('---');
  out.push('');
  out.push(`## \`${path}\``);
  out.push(`_${ep.count} request(s), ${ep.fields.size} distinct fields_`);
  out.push('');
  out.push('| field | type(s) | seen | likely options |');
  out.push('|---|---|---|---|');

  const fields = [...ep.fields.entries()].sort((a, b) => b[1].seen - a[1].seen);
  for (const [key, f] of fields) {
    const types = [...f.types].slice(0, 3).join(' \\| ');
    const opts = f.samples.size >= 2 && f.samples.size <= 12
      ? [...f.samples].map((s) => `\`${s}\``).join(', ')
      : '';
    out.push(`| \`${key}\` | ${types} | ${f.seen} | ${opts} |`);
  }
  out.push('');
}

const dest = file.replace(/\.har$/i, '') + '-inventory.md';
writeFileSync(dest, out.join('\n'));

console.log(`Parsed ${jsonResponses} JSON responses across ${endpoints.size} endpoints.`);
console.log(`Report written to: ${dest}`);
console.log('');
console.log('Top endpoints by traffic:');
for (const [path, ep] of sorted.slice(0, 12)) {
  console.log(`  ${String(ep.count).padStart(4)}  ${ep.fields.size.toString().padStart(3)} fields  ${path}`);
}
