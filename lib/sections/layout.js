/**
 * How a section's repeating rows are laid out as Filevine-style item cards.
 *
 * ── Why cards ─────────────────────────────────────────────────────────────
 *
 * Medicals has nineteen fields per row. Each is an input box needing 120-320px
 * (columns.js), so the table was ~4,000px wide and staff scrolled sideways to
 * reach half of it. Text can wrap; an input box cannot shrink below usable.
 *
 * Filevine's answer, taken here: READING AND EDITING ARE SEPARATE. In the list,
 * each row is a card showing a left and right "main field" as its header and
 * only the fields that have a value beneath -- five filled values, not
 * nineteen empty boxes. Editing opens the row in a form of headed groups on a
 * two-column grid of deliberate pairs (Bills ordered / Bills received).
 * Sources: Filevine help centre, "Static and Collections Sections" and
 * "Collection Tabs Update - Enhanced Display Settings"; and the firm's printed
 * Filevine section sheets, docs/REFERENCE_FILEVINE_AND_RLF.md §10.
 *
 * Pure: no React, no database. The two things that must not go wrong are both
 * decided here and both tested -- see the ⚠️ notes below.
 */

import { contactCellName } from '../domain/contact.js';
import { formatMoney, parseMoney } from '../domain/settlement.js';
import { fmt } from '../domain/dates.js';

/** Tables at or below this many columns fit on screen and stay tables. */
export const CARD_THRESHOLD = 6;

/** Types that take the full width of the editor rather than half. */
const FULL_WIDTH = new Set(['textarea', 'multiselect', 'attachments']);

/** Columns worth a header slot when a table has no `item` block of its own. */
const NAME_LIKE = new Set(['contact', 'text', 'select']);
const RIGHT_LIKE = new Set(['money', 'date', 'calculated']);

export function usesCards(collection) {
  return (collection?.columns || []).length > CARD_THRESHOLD;
}

/**
 * The card and editor layout for one collection.
 *
 * @returns {{
 *   left: string|null, right: string|null, status: string|null,
 *   groups: Array<{ title: string, fields: Array<{ key: string, full: boolean }> }>,
 * }}
 *
 * The header fields (left, right, status) are shown on the card AND edited in
 * the editor's first group, so every column has exactly one editor.
 *
 * ⚠️ EVERY COLUMN APPEARS EXACTLY ONCE, WHATEVER THE CONFIG SAYS.
 *
 * A field left out of a layout would be data that exists and can be neither
 * seen nor changed -- the fault this app has now hit six times (Drive
 * folders, client contacts, addresses, author labels...). So a column the
 * `item` block forgot is not dropped: it lands in a trailing "More" group.
 * A column listed twice is kept at its first place. The registry test then
 * asserts the configured layouts have no leftovers, so "More" is a safety net
 * and not a design.
 */
export function itemLayout(collection) {
  const columns = collection?.columns || [];
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const cfg = collection?.item || {};

  const has = (k) => typeof k === 'string' && byKey.has(k);
  const left = has(cfg.left) ? cfg.left
    : (columns.find((c) => NAME_LIKE.has(c.type))?.key ?? columns[0]?.key ?? null);
  const right = has(cfg.right) ? cfg.right
    : (columns.find((c) => RIGHT_LIKE.has(c.type) && c.key !== left)?.key ?? null);
  const status = has(cfg.status) ? cfg.status : null;

  const placed = new Set();
  const field = (key) => {
    const col = byKey.get(key);
    placed.add(key);
    return { key, full: FULL_WIDTH.has(col.type) || Boolean(col.full) };
  };

  const groups = [];
  const header = [left, right, status].filter((k) => k && !placed.has(k)).map(field);
  if (header.length) groups.push({ title: '', fields: header });

  for (const g of cfg.groups || []) {
    const fields = (g.fields || []).filter((k) => has(k) && !placed.has(k)).map(field);
    if (fields.length) groups.push({ title: g.title || '', fields });
  }

  const rest = columns.filter((c) => !placed.has(c.key)).map((c) => field(c.key));
  if (rest.length) groups.push({ title: cfg.groups?.length ? 'More' : '', fields: rest });

  return { left, right, status, groups };
}

/** Columns the configured `item` block did not place -- for the registry test. */
export function unplacedColumns(collection) {
  const cfg = collection?.item;
  if (!cfg) return [];
  const listed = new Set([cfg.left, cfg.right, cfg.status, ...(cfg.groups || []).flatMap((g) => g.fields || [])]);
  return (collection.columns || []).map((c) => c.key).filter((k) => !listed.has(k));
}

/* ------------------------------------------------------------------ *
 * Reading a value for display
 * ------------------------------------------------------------------ */

const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []);

/** True when a cell has nothing worth showing on a card. */
export function isEmptyValue(column, value) {
  if (value === null || value === undefined) return true;
  switch (column?.type) {
    case 'datedone':
      return !(value && typeof value === 'object' && (value.dateValue || value.doneDate));
    case 'attachments':
    case 'multiselect':
      return asList(value).filter(Boolean).length === 0;
    case 'driveFile':
      return !(value && typeof value === 'object' && (value.id || value.name || value.url));
    case 'calculated':
      return false;
    default:
      return displayValue(column, value) === '';
  }
}

/**
 * The text a card shows for a cell. Empty string when there is nothing.
 *
 * ⚠️ NEVER "[object Object]". A contact picked from the list is stored as
 * { id, name }, and String() of that is how the Settlement Calculator printed
 * "[object Object]" for every linked provider (fixed 437a1da). Everything
 * object-shaped goes through a reader that knows its shape, and anything else
 * object-shaped that arrives here unexpectedly shows as nothing rather than
 * as the word Object.
 */
export function displayValue(column, value, row = {}) {
  const type = column?.type;

  if (type === 'calculated') {
    const [a, b] = column.inputs || [];
    const cents = (parseMoney(row?.[a]) || 0) - (parseMoney(row?.[b]) || 0);
    return formatMoney(cents, { blank: '' });
  }
  if (value === null || value === undefined || value === '') return '';

  /*
   * Types that hold a plain value. Anything object-shaped arriving in one of
   * these -- a contact pasted into an amount, a half-migrated cell -- would
   * reach String() below and print "[object Object]". The test that runs
   * every column against every shape found exactly that on meds.amount.
   */
  const OBJECT_TYPES = new Set(['contact', 'datedone', 'multiselect', 'attachments', 'driveFile']);
  if (typeof value === 'object' && !OBJECT_TYPES.has(type)) {
    return typeof value?.name === 'string' ? value.name.trim() : '';
  }

  switch (type) {
    case 'contact':
      return contactCellName(value);
    case 'money': {
      const cents = parseMoney(value);
      return cents === null ? String(value).trim() : formatMoney(cents, { blank: '' });
    }
    case 'date':
      return fmt(value, { fallback: typeof value === 'string' ? value : '' });
    case 'datedone': {
      if (!value || typeof value !== 'object') return '';
      const due = value.dateValue ? `Due ${fmt(value.dateValue, { fallback: value.dateValue })}` : '';
      const done = value.doneDate ? `Done ${fmt(value.doneDate, { fallback: value.doneDate })}` : '';
      return [due, done].filter(Boolean).join(' · ');
    }
    case 'multiselect':
      return asList(value)
        .map((v) => (v && typeof v === 'object' ? String(v.name || '') : String(v ?? '')).trim())
        .filter(Boolean)
        .join(', ');
    case 'attachments': {
      const n = asList(value).filter(Boolean).length;
      return n ? `${n} file${n === 1 ? '' : 's'}` : '';
    }
    case 'driveFile':
      return value && typeof value === 'object' ? String(value.name || '').trim() : String(value).trim();
    default:
      if (typeof value === 'object') {
        return typeof value.name === 'string' ? value.name.trim() : '';
      }
      return String(value).trim();
  }
}

/** The files a document cell holds, for chips on the card. */
export function filesOf(column, value) {
  if (column?.type === 'attachments') return asList(value).filter((f) => f && typeof f === 'object');
  if (column?.type === 'driveFile' && value && typeof value === 'object' && (value.id || value.url)) return [value];
  return [];
}

/**
 * What a card shows beneath its header: every non-header field that has a
 * value, in layout order, plus how many were empty.
 *
 * Empty fields are hidden, as Filevine hides them -- a card is for reading.
 * The count keeps them from vanishing silently: "7 fields empty" says there
 * is more to fill in without drawing seven empty boxes.
 */
export function previewFields(collection, row = {}) {
  const layout = itemLayout(collection);
  const byKey = new Map((collection?.columns || []).map((c) => [c.key, c]));
  const header = new Set([layout.left, layout.right, layout.status].filter(Boolean));

  const shown = [];
  let empty = 0;
  for (const g of layout.groups) {
    for (const f of g.fields) {
      if (header.has(f.key)) continue;
      const col = byKey.get(f.key);
      const value = row?.[f.key];
      if (isEmptyValue(col, value)) { empty++; continue; }
      shown.push({
        key: f.key,
        label: col.label,
        type: col.type,
        text: displayValue(col, value, row),
        files: filesOf(col, value),
        long: col.type === 'textarea',
      });
    }
  }
  return { shown, empty };
}
