/**
 * Spreadsheet import.
 *
 * The firm lost access to its old system with no export, so the case list is
 * being rebuilt by hand from court records, Drive folder names, calendars and
 * the paralegals' own spreadsheets. That means data arrives in WAVES, from
 * several sources, in whatever shape the source produced -- and the same case
 * will be imported more than once as more is recovered.
 *
 * Three consequences shape everything here:
 *
 *   1. NOTHING IS WRITTEN UNTIL A HUMAN HAS SEEN THE PLAN. Every function in
 *      this file is pure. `planImport` decides create/update/skip and explains
 *      each decision; the caller renders that, and only then commits.
 *
 *   2. RE-IMPORT MUST NOT DUPLICATE. Rows are matched to existing matters by
 *      case number, so the same file imported twice updates rather than
 *      doubling. Rows with no case number cannot be matched -- that is called
 *      out per row rather than guessed at.
 *
 *   3. A WRONG DATE IS WORSE THAN A MISSING ONE. See the convention detection
 *      below; this is the part of the file that earns its keep.
 */

import { parseISO, isValidISO } from './dates.js';
import { FIELD_BY_KEY, DOC_FIELDS, guessField, isYes } from './fields.js';
import { nameKey } from './drive-match.js';

/* ------------------------------------------------------------------ *
 * Dates
 * ------------------------------------------------------------------ */

/**
 * 03/04/2026 is March 4th in Houston and April 3rd in London, and no amount of
 * looking at that one cell will tell you which. Guessing per-cell is how an
 * SOL lands eleven months from where it belongs.
 *
 * So the convention is decided for a COLUMN, from every value in it, not for a
 * cell. Across a real column the answer usually falls out: one row with a 13th
 * or higher in the first position proves the column is not month-first, and
 * one in the second position proves it is not day-first. A column that never
 * disambiguates is reported as ambiguous and the caller must choose -- it is
 * not silently assumed.
 *
 * Returns one of:
 *   'ISO'        every value was YYYY-MM-DD
 *   'MDY'        proven month-first
 *   'DMY'        proven day-first
 *   'ambiguous'  slash dates, but nothing above 12 anywhere
 *   'conflict'   both proofs present -- the column mixes formats
 *   'empty'      nothing parseable to judge
 */
export function detectDateConvention(values = []) {
  let sawSlash = false;
  let sawISO = false;
  let firstOver12 = false;
  let secondOver12 = false;

  for (const raw of values) {
    const s = String(raw ?? '').trim();
    if (!s) continue;

    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { sawISO = true; continue; }

    const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
    if (!m) continue;

    sawSlash = true;
    if (+m[1] > 12) firstOver12 = true;
    if (+m[2] > 12) secondOver12 = true;
  }

  if (firstOver12 && secondOver12) return 'conflict';
  if (firstOver12) return 'DMY';
  if (secondOver12) return 'MDY';
  if (sawSlash) return 'ambiguous';
  if (sawISO) return 'ISO';
  return 'empty';
}

/*
 * Excel writes dates as a day count from 1899-12-30, and a CSV exported from
 * some tools carries the raw number instead of a formatted date. Left alone
 * that becomes a silently dropped SOL, so bare integers in a plausible range
 * are converted. The range is deliberately narrow -- 1954 to 2064 -- so that a
 * stray number in a date column is rejected rather than read as a date.
 */
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const EXCEL_MIN = 20000; // 1954-10-03
const EXCEL_MAX = 60000; // 2064-04-04

export function excelSerialToISO(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < EXCEL_MIN || n > EXCEL_MAX) return null;
  const d = new Date(EXCEL_EPOCH_UTC + n * 86400000);
  const iso = d.toISOString().slice(0, 10);
  return isValidISO(iso) ? iso : null;
}

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Two-digit years: 26 -> 2026, 98 -> 1998. A case file is not from 2098. */
function expandYear(y) {
  const n = +y;
  if (y.length === 4) return n;
  return n <= 69 ? 2000 + n : 1900 + n;
}

function iso(y, m, d) {
  const s = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isValidISO(s) ? s : null;
}

/**
 * Parse one cell into "YYYY-MM-DD", or null.
 *
 * `convention` comes from detectDateConvention over the whole column. Passing
 * 'ambiguous' means the caller has not resolved it and the value is refused --
 * refusing is the point, because the alternative is a plausible wrong date.
 */
export function parseImportDate(raw, convention = 'ISO') {
  const s = String(raw ?? '').trim();
  if (!s) return null;

  // Already ISO.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return isValidISO(s) ? s : null;

  // A written-out month is never ambiguous, so it needs no convention. The two
  // word orders get a pattern each -- one regex trying to cover both cannot
  // tell which capture group is the day.
  //
  //   "March 4, 2026" / "Mar 4 2026" / "October 15th, 2026"
  const monthFirst = /^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2}|\d{4})$/i.exec(s);
  if (monthFirst) {
    const mon = MONTHS[monthFirst[1].slice(0, 3).toLowerCase()];
    if (mon) return iso(expandYear(monthFirst[3]), mon, +monthFirst[2]);
  }

  //   "4 Mar 2026" / "15 October 2026"
  const dayFirst = /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?,?\s+(\d{2}|\d{4})$/i.exec(s);
  if (dayFirst) {
    const mon = MONTHS[dayFirst[2].slice(0, 3).toLowerCase()];
    if (mon) return iso(expandYear(dayFirst[3]), mon, +dayFirst[1]);
  }

  // Excel serial.
  if (/^\d+$/.test(s)) return excelSerialToISO(s);

  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (!m) return null;

  const a = +m[1];
  const b = +m[2];
  const year = expandYear(m[3]);

  if (convention === 'MDY') return iso(year, a, b);
  if (convention === 'DMY') return iso(year, b, a);

  // ISO/ambiguous/conflict/empty: only accept what cannot be misread.
  if (a > 12 && b <= 12) return iso(year, b, a);
  if (b > 12 && a <= 12) return iso(year, a, b);
  return null;
}

/*
 * A date-shaped token anywhere inside a longer string.
 *
 * `parseImportDate` is anchored, because a whole cell that is meant to BE a
 * date should be one. Checklist columns are different: they are kept as prose
 * with a date in the middle of it -- "yes, but only as to Metro - 3/1/26" --
 * and the date there is real.
 *
 * Only separator-bearing forms are searched for. A bare number is deliberately
 * not treated as an Excel serial here, because inside free text a lone number
 * is far more likely to be a case number, a count, or a citation.
 */
const DATE_TOKEN = /\d{4}-\d{2}-\d{2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/;

export function findDateIn(text, convention = 'ISO') {
  const m = DATE_TOKEN.exec(String(text ?? ''));
  if (!m) return { date: null, token: '' };
  const date = parseImportDate(m[0], convention);
  return { date, token: date ? m[0] : '' };
}

/* ------------------------------------------------------------------ *
 * Status
 * ------------------------------------------------------------------ */

const STATUS_SYNONYMS = [
  [/^open|^active|^pending|^litigation|^pre-?suit/i, 'Open'],
  [/^closed|^complete|^disbursed|^archived|^resolved/i, 'Closed'],
  [/^settled|^settlement/i, 'Settled - Not Disbursed'],
  [/^default/i, 'Default Judgment'],
];

/**
 * Map a free-text status onto the four the app knows.
 *
 * Unrecognised values become 'Open' AND are reported. Open is the safer
 * default of the two available mistakes: a closed case showing as active adds
 * noise to a dashboard, while dropping the row loses the case. Neither is
 * silent -- the caller lists every row this happened to.
 */
export function normalizeStatus(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { status: 'Open', recognized: true };
  for (const [re, status] of STATUS_SYNONYMS) {
    if (re.test(s)) return { status, recognized: true };
  }
  return { status: 'Open', recognized: false };
}

/* ------------------------------------------------------------------ *
 * Header mapping
 * ------------------------------------------------------------------ */

/**
 * Propose a field for each column, using the header map the app already
 * carries. `overrides` is the human's correction, keyed by column index, and
 * always wins. An empty override means "ignore this column".
 */
export function mapHeaders(headers = [], overrides = {}) {
  return headers.map((header, index) => {
    const guessed = guessField(header);
    const key = Object.prototype.hasOwnProperty.call(overrides, index)
      ? overrides[index]
      : guessed;
    return {
      index,
      header: String(header ?? ''),
      guessed,
      key: key || '',
      field: key ? FIELD_BY_KEY[key] || null : null,
      overridden: Object.prototype.hasOwnProperty.call(overrides, index) && overrides[index] !== guessed,
    };
  });
}

/**
 * Every column carrying dates, with the convention detected for each.
 *
 * Checklist columns count, and leaving them out was a real bug: they hold
 * "yes - 3/1/26", so they carry dates too, and with no convention detected for
 * them every embedded date fell through to 'ambiguous' and was refused. The
 * completion survived and the date silently did not.
 *
 * That is not cosmetic. chain.js generates deadlines from five of these --
 * served, plDiscoverySent, defDiscoveryReceived, recordsOrdered and plDepo --
 * so a dropped checklist date is a deadline that never appears.
 *
 * A checklist cell is prose with a date inside it, so detection runs over the
 * date-shaped token extracted from each cell rather than the whole cell.
 */
export function dateConventions(columns, rows) {
  const out = {};
  for (const col of columns) {
    if (!col.key) continue;
    const isDateField = col.field?.type === 'date';
    const isChecklist = DOC_FIELDS.has(col.key);
    if (!isDateField && !isChecklist) continue;

    const values = rows.map((r) => {
      const cell = String(r[col.index] ?? '');
      if (isDateField) return cell;
      const m = DATE_TOKEN.exec(cell);
      return m ? m[0] : '';
    });
    out[col.key] = detectDateConvention(values);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * The plan
 * ------------------------------------------------------------------ */

/** Case numbers compare without spacing or case: " 26-001 " is 26-001. */
export function caseKey(value) {
  return String(value ?? '').trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * The row number a person will see in Excel, from our zero-based index.
 *
 * Off by one twice: rows are counted from 1, and row 1 is the header. Both the
 * plan's messages and the review table have to agree, or "also appears on row
 * 2" sends someone to a row the table labels 3 -- which is how it read before
 * this existed in one place.
 */
export function spreadsheetRow(rowIndex) {
  return rowIndex + 2;
}

function indexExisting(matters = {}) {
  const byCase = new Map();
  const byName = new Map();
  for (const [id, m] of Object.entries(matters)) {
    const v = m?.values || {};
    const ck = caseKey(v.caseNumber);
    if (ck) byCase.set(ck, id);
    const nk = nameKey(v.clientName);
    if (nk) {
      if (!byName.has(nk)) byName.set(nk, []);
      byName.get(nk).push(id);
    }
  }
  return { byCase, byName };
}

/**
 * Turn parsed rows into a reviewable plan.
 *
 * Every entry carries the decision AND the reason for it, because the screen
 * that renders this is the last point at which a person can catch a bad file.
 * Nothing here writes anything.
 *
 * `rows` are arrays of cell values, aligned to `columns[].index`.
 */
export function planImport({
  rows = [],
  columns = [],
  matters = {},
  conventions = {},
  resolvedConventions = {},
} = {}) {
  const { byCase, byName } = indexExisting(matters);
  const mapped = columns.filter((c) => c.key);
  const entries = [];

  // Case numbers seen within THIS file, to catch a file that duplicates itself.
  const seenInFile = new Map();

  rows.forEach((row, rowIndex) => {
    const values = {};
    const checklist = {};
    const warnings = [];

    for (const col of mapped) {
      const raw = row[col.index];
      const cell = String(raw ?? '').trim();
      if (!cell) continue;

      if (DOC_FIELDS.has(col.key)) {
        // "yes - 3/1/26" is both a completion and a date, which is how these
        // columns are actually kept. Take both; keep the raw text either way,
        // because a note nobody can read is still evidence and the alternative
        // is discarding it.
        const done = isYes(cell);
        const conv = resolvedConventions[col.key] || conventions[col.key] || 'ambiguous';
        const withoutYes = cell.replace(/^\s*y(es)?\b[\s,:-]*/i, '');
        const { date: embedded, token } = findDateIn(withoutYes, conv);

        /*
         * The raw text is kept unless the cell is FULLY explained by what was
         * extracted. "yes - 3/1/26" is, so the note would only repeat the two
         * fields beside it. "yes, but only as to Metro - 3/1/26" is not, and
         * dropping that clause would lose the only record of it.
         *
         * So: remove the yes-word and the date token, and see whether anything
         * with meaning is left.
         */
        const residue = (token ? withoutYes.replace(token, '') : withoutYes)
          .replace(/[^a-z0-9]/gi, '');

        checklist[col.key] = {
          done,
          date: embedded || '',
          note: residue ? cell : '',
        };
        continue;
      }

      const field = col.field;
      if (field?.type === 'date') {
        const conv = resolvedConventions[col.key] || conventions[col.key] || 'ISO';
        if (conv === 'ambiguous' || conv === 'conflict') {
          warnings.push(`${field.label}: "${cell}" not read — the column's date format is ${conv}`);
          continue;
        }
        const parsed = parseImportDate(cell, conv);
        if (!parsed) {
          warnings.push(`${field.label}: "${cell}" is not a date I can read`);
          continue;
        }
        values[col.key] = parsed;
        continue;
      }

      if (col.key === 'status') {
        const { status, recognized } = normalizeStatus(cell);
        if (!recognized) warnings.push(`Status "${cell}" is not one of the four — imported as Open`);
        values.status = status;
        continue;
      }

      values[col.key] = cell;
    }

    const clientName = (values.clientName || '').trim();
    const ck = caseKey(values.caseNumber);

    if (!clientName) {
      entries.push({
        rowIndex, action: 'skip', reason: 'No client name in this row', values, checklist, warnings,
      });
      return;
    }

    if (ck && seenInFile.has(ck)) {
      entries.push({
        rowIndex,
        action: 'skip',
        reason: `Case number ${values.caseNumber} also appears on row ${spreadsheetRow(seenInFile.get(ck))} of this file`,
        values, checklist, warnings,
      });
      return;
    }
    if (ck) seenInFile.set(ck, rowIndex);

    const existingId = ck ? byCase.get(ck) : undefined;

    if (existingId) {
      entries.push({
        rowIndex,
        action: 'update',
        matterId: existingId,
        reason: `Matches existing case ${values.caseNumber}`,
        // What this case ALREADY has. A file with no SOL column does not
        // remove one, so the count of cases left without an SOL has to look at
        // the result of the import, not at the file.
        existingSol: matters[existingId]?.values?.sol || '',
        values, checklist, warnings,
      });
      return;
    }

    if (!ck) {
      warnings.push('No case number — this row cannot be matched, so importing the file again would create a second copy');
      const nk = nameKey(clientName);
      if (byName.has(nk)) {
        warnings.push(`A case for "${clientName}" already exists — check this is not the same file`);
      }
    }

    entries.push({
      rowIndex, action: 'create', reason: 'New case', values, checklist, warnings,
    });
  });

  return { entries, summary: summarize(entries) };
}

export function summarize(entries = []) {
  const s = { create: 0, update: 0, skip: 0, warnings: 0, withSol: 0, total: entries.length };
  for (const e of entries) {
    s[e.action] += 1;
    s.warnings += e.warnings.length;
    if (e.action !== 'skip' && (e.values.sol || e.existingSol)) s.withSol += 1;
  }
  return s;
}

/**
 * Columns whose date format could not be settled from the data.
 *
 * The import screen blocks on these: a human picks the format, or the column
 * is dropped. It does not offer a default, because the whole reason this
 * exists is that the plausible default is wrong half the time.
 */
export function unresolvedDateColumns(conventions = {}, resolved = {}) {
  return Object.entries(conventions)
    .filter(([key, conv]) => (conv === 'ambiguous' || conv === 'conflict') && !resolved[key])
    .map(([key, conv]) => ({ key, convention: conv, label: FIELD_BY_KEY[key]?.label || key }));
}
