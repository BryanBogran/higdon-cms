#!/usr/bin/env node
/**
 * Pull real section/field definitions out of a Filevine HAR.
 *
 *   node scripts/extract-sections.mjs imports/filevine.har
 *
 * Filevine names custom things `<key><numericId>` — `partytype245793` in the
 * `parties20318` section, where 20318 is the firm's template id and 245793 is
 * that field's id. Stripping the suffix gives a clean, readable key; keeping it
 * alongside preserves the join back to the export.
 *
 * Rows live under `data.collection[]`, which confirms what the generic section
 * engine already assumes: a Filevine section is a repeating collection.
 *
 * PRIVACY: emits field NAMES and TYPES. Values are printed only where a field
 * looks like a picklist and its key is not personal — those option lists are
 * the configuration we're trying to recover.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2] || 'imports/filevine.har';
const har = JSON.parse(readFileSync(file, 'utf8'));
const entries = har?.log?.entries || [];

/**
 * REDACTION — third attempt, and the first that is actually safe.
 *
 * This script runs over live medical records, so the failure mode matters more
 * than the feature. Two earlier versions both failed open:
 *
 *   1. A DENYLIST of key names (name|email|phone|...). `diagnoses`, `facility`,
 *      `provider`, `prognosis` and `medicationsprescribed` match none of those
 *      words, so a real patient's record was printed as "likely options".
 *
 *   2. A frequency heuristic — "a picklist repeats, free text does not". This
 *      firm's med-chron entries are templated, so `MVC-related injuries`,
 *      `Discharge from ED` and pain scores all recurred and sailed through.
 *      Recurrence is not evidence of configuration.
 *
 * So the default is inverted. NOTHING is printed unless its key is on a short
 * allowlist of things that are unambiguously pickers. Everything else is
 * counted and withheld, so the field stays visible without its contents.
 *
 * The general lesson: a denylist has to anticipate every field name a firm
 * might invent, and there is no version of it that is complete. An allowlist
 * only has to name the few keys that are configuration.
 */
const PICKER_KEY = /^(.*type|.*status|category|kind|priority|stage|phase|role|.*class)$/i;

// Dates are data, never configuration, whatever the key is called.
const isDateish = (v) => /^\d{4}-\d{2}-\d{2}/.test(v);
const NOISE_KEY = /^(id|orgID|projectID|uniqueID|clientEntityId|orgMetaVersionID|pictureUrl|pictureKey|imageKey|createdDate|modifiedDate|isArchived|initials|initialsFirstLast|abbreviatedName)$/;

const stripId = (k) => k.replace(/\d{4,}$/, '');

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return v.length ? `array<${typeOf(v[0])}>` : 'array';
  if (typeof v === 'object') return 'object';
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'decimal';
  if (typeof v === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return 'datetime';
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'date';
    if (/^https?:\/\//.test(v)) return 'url';
    if (v.includes('@')) return 'email';
    return 'text';
  }
  return typeof v;
}

const sections = new Map(); // sectionKey -> { fields: Map, rows: n, actions: Set }

for (const e of entries) {
  const url = e?.request?.url || '';
  const text = e?.response?.content?.text;
  if (!text) continue;

  const m = url.match(/\/custom\/([a-z0-9]+)(\/([A-Za-z]+))?(\?|$)/);
  if (!m) continue;
  const sectionKey = stripId(m[1]);
  const sub = m[3] || '';

  let json;
  try { json = JSON.parse(text); } catch { continue; }

  if (!sections.has(sectionKey)) {
    sections.set(sectionKey, { fields: new Map(), rows: 0, actions: new Set(), raw: m[1] });
  }
  const sec = sections.get(sectionKey);

  // Action buttons — the "what can this section DO" question.
  if (/ActionButton/i.test(sub)) {
    const walk = (o) => {
      if (!o || typeof o !== 'object') return;
      for (const [k, v] of Object.entries(o)) {
        if (/^(name|label|buttonName|actionName|title)$/i.test(k) && typeof v === 'string' && v.trim()) {
          sec.actions.add(v.trim());
        }
        if (typeof v === 'object') walk(v);
      }
    };
    walk(json);
    continue;
  }

  const collection = json?.data?.collection;
  if (!Array.isArray(collection)) continue;
  sec.rows = Math.max(sec.rows, collection.length);

  for (const row of collection.slice(0, 30)) {
    for (const [rawKey, v] of Object.entries(row)) {
      const key = stripId(rawKey);
      if (NOISE_KEY.test(key)) continue;
      if (!sec.fields.has(key)) {
        sec.fields.set(key, { raw: rawKey, types: new Set(), seen: 0, counts: new Map(), sub: new Set() });
      }
      const f = sec.fields.get(key);
      f.types.add(typeOf(v));
      f.seen++;

      // Tally everything; what may actually be printed is decided at report
      // time, by the allowlist.
      if (typeof v === 'string' && v) {
        f.counts.set(v, (f.counts.get(v) || 0) + 1);
      }
      // A nested object is a linked entity (a contact, say) -- record its shape.
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const nk of Object.keys(v)) {
          const clean = stripId(nk);
          if (!NOISE_KEY.test(clean) && f.sub.size < 40) f.sub.add(clean);
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ */

const out = [];
out.push('# Filevine custom sections — real field definitions');
out.push('');
out.push(`Extracted from \`${file}\`. Field keys have their numeric ids stripped for`);
out.push('readability; the raw key is kept so rows can be joined back to an export.');
out.push('');
out.push(`**${sections.size} sections captured.**`);
out.push('');

for (const [key, sec] of [...sections].sort()) {
  out.push('---');
  out.push('');
  out.push(`## ${key}`);
  out.push(`_raw key \`${sec.raw}\` · ${sec.fields.size} fields · ${sec.rows} row(s) in the captured matter_`);
  out.push('');

  if (sec.actions.size) {
    out.push(`**Action buttons:** ${[...sec.actions].map((a) => `\`${a}\``).join(', ')}`);
    out.push('');
  }

  if (!sec.fields.size) {
    out.push('_No rows in the captured matter — section exists but is empty here._');
    out.push('');
    continue;
  }

  out.push('| field | type | linked entity fields | options seen |');
  out.push('|---|---|---|---|');
  for (const [fk, f] of sec.fields) {
    const types = [...f.types].filter((t) => t !== 'null').join(' / ') || 'null';
    const subs = f.sub.size ? [...f.sub].slice(0, 14).join(', ') : '';
    // Allowlist only. A value escapes solely when its KEY is unmistakably a
    // picker, the value is short, and it is not a date. Everything else is
    // reported as a bare count, so the field stays visible without contents.
    const distinct = [...f.counts.keys()];
    const allowed =
      PICKER_KEY.test(fk) &&
      distinct.length > 0 &&
      distinct.length <= 12 &&
      distinct.every((v) => v.length <= 40 && !isDateish(v));
    const opts = allowed
      ? distinct.map((o) => `\`${o}\``).join(', ')
      : distinct.length
        ? `_${distinct.length} distinct — withheld_`
        : '';
    out.push(`| \`${fk}\` | ${types} | ${subs} | ${opts} |`);
  }
  out.push('');
}

const dest = 'imports/filevine-sections.md';
writeFileSync(dest, out.join('\n'));

console.log(`${sections.size} sections extracted -> ${dest}\n`);
for (const [key, sec] of [...sections].sort()) {
  const a = sec.actions.size ? `  actions: ${[...sec.actions].join(' | ')}` : '';
  console.log(`  ${key.padEnd(16)} ${String(sec.fields.size).padStart(3)} fields  ${sec.rows} rows${a}`);
}
