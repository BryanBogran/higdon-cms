/**
 * Filtering and sorting the case list.
 *
 * Pulled out of the Project Hub page because these are rules, not rendering:
 * what counts as an unknown insurance class, how a case number orders against
 * a case with none, whether a deposition marked done with no date counts as
 * taken. Each is a decision, each is one line to get wrong, and none of them
 * can be tested inside a React component.
 */

import { matchesCaseSearch } from './search.js';
import { FIELD_BY_KEY, FIELDS } from '@/lib/domain/fields';
import { matterTitle, daysSinceActivity } from '@/lib/domain/matter';

/* ------------------------------------------------------------------ *
 * Sorting
 * ------------------------------------------------------------------ */

export const SORTS = [
  { key: 'activity', label: 'Last activity' },
  { key: 'name', label: 'Name A–Z' },
  { key: 'caseNumber', label: 'Case number' },
];

/**
 * Case numbers compare as STRINGS, and that is correct rather than lazy.
 *
 * Every one is YY-NNN — same width, zero-padded, digits only — so "16-529"
 * < "21-064" < "26-101" lexically and chronologically at once. Parsing them
 * into numbers would buy nothing and would have to decide what to do with a
 * malformed one.
 */
const BY = {
  caseNumber: {
    missing: (r) => !String(r?.matter?.values?.caseNumber || '').trim(),
    compare: (a, b) => String(a.matter.values.caseNumber).trim()
      .localeCompare(String(b.matter.values.caseNumber).trim()),
  },
  name: {
    // Surname-first, which is how the firm reads and files a list of clients.
    missing: (r) => !matterTitle(r?.matter).trim(),
    compare: (a, b) => matterTitle(a.matter).localeCompare(
      matterTitle(b.matter), undefined, { sensitivity: 'base', numeric: true }),
  },
  activity: {
    missing: (r) => r?.stale === null || r?.stale === undefined,
    // `stale` is DAYS SINCE, so ascending puts the most recently touched
    // first. That is the default the hub opens on: "what is moving".
    compare: (a, b) => a.stale - b.stale,
  },
};

/** Wording that says what the button will do, in terms of the current sort. */
export function directionLabel(sort, direction) {
  const asc = direction !== 'desc';
  if (sort === 'name') return asc ? 'A–Z' : 'Z–A';
  if (sort === 'caseNumber') return asc ? 'Oldest number first' : 'Newest number first';
  return asc ? 'Most recent first' : 'Least recent first';
}

/**
 * @param {'asc'|'desc'} direction
 *
 * ⚠️ MISSING VALUES STAY LAST IN BOTH DIRECTIONS.
 *
 * Reversing a sort must not promote the rows that have nothing to sort on. A
 * case with no number is not "the highest number" — it is missing, and
 * flipping to descending should surface 26-101, not the six folders nobody
 * numbered. So the rows are partitioned first and only the ones with a value
 * are reversed. Negating the whole comparator, which is the obvious
 * implementation, gets this exactly wrong.
 */
export function sortRows(rows = [], sort = 'activity', direction = 'asc') {
  const spec = BY[sort] || BY.activity;
  const sign = direction === 'desc' ? -1 : 1;

  const present = [];
  const missing = [];
  for (const r of rows) (spec.missing(r) ? missing : present).push(r);

  // A stable tiebreak, so two cases that compare equal do not swap places
  // between renders. It follows the direction too, or a descending list would
  // order its ties ascending.
  const byName = (a, b) => BY.name.compare(a, b);
  present.sort((a, b) => sign * (spec.compare(a, b) || byName(a, b)));

  // The leftovers are ordered among themselves by name, so they are at least
  // findable rather than in insertion order.
  missing.sort(byName);

  return [...present, ...missing];
}

/* ------------------------------------------------------------------ *
 * Case type — the Commercial / Personal Lines field
 * ------------------------------------------------------------------ */

export const CASE_TYPES = FIELD_BY_KEY.commercial?.options || [];

/**
 * A blank IS "Unknown".
 *
 * The field offers Unknown as a choice, so a case can reach that value two
 * ways: somebody selected it, or nobody has touched the field. On a list of
 * 359 imported cases almost all of them are the second, and a filter that
 * returned four results while 355 sat unclassified would read as broken.
 * They mean the same thing to the person asking, so they are the same filter.
 */
export function matchesCaseType(matter, wanted) {
  if (!wanted) return true;
  const value = String(matter?.values?.commercial || '').trim();
  if (wanted === 'Unknown') return !value || value === 'Unknown';
  return value === wanted;
}

/* ------------------------------------------------------------------ *
 * Depositions
 * ------------------------------------------------------------------ */

export const DEPO_FILTERS = [
  { key: 'pl', label: "Plaintiff's depo taken" },
  { key: 'def', label: "Defendant's depo taken" },
  { key: 'either', label: 'Either depo taken' },
  { key: 'neither', label: 'No depo taken yet' },
];

/**
 * Taken means the box is TICKED, date or no date.
 *
 * `lib/domain/chain.js` requires `done AND occurred_on` before it will
 * generate a deadline, and rightly — a rule cannot compute a date from a date
 * that is not there. This is a different question. "Which cases still need the
 * plaintiff deposed" is answered by the tick alone, and excluding a deposition
 * somebody recorded without the date would hide work that is genuinely done.
 */
function depoTaken(matter, key) {
  return Boolean(matter?.values?.[key]?.done);
}

export function matchesDepo(matter, filter) {
  if (!filter) return true;
  const pl = depoTaken(matter, 'plDepo');
  const def = depoTaken(matter, 'defDepo');
  if (filter === 'pl') return pl;
  if (filter === 'def') return def;
  if (filter === 'either') return pl || def;
  if (filter === 'neither') return !pl && !def;
  return true;
}

/* ------------------------------------------------------------------ *
 * Any checklist item, done or not
 * ------------------------------------------------------------------ */

/**
 * One filter option per checklist item per state.
 *
 * DERIVED FROM `FIELDS`, not written out again. There are 13 checklist items
 * across five sections and they are already declared once, with their section,
 * in lib/domain/fields.js. A second hand-kept list here would drift the first
 * time somebody adds an item -- and the failure would be silent: the item
 * appears on the case, and simply cannot be filtered by.
 *
 * Grouped by section so the dropdown reads the way the rail does.
 */
export const CHECKLIST_FILTERS = FIELDS
  .filter((f) => f.type === 'yesnoDoc')
  .flatMap((f) => [
    { key: `${f.key}:done`, section: f.section, label: `${f.label} — done` },
    { key: `${f.key}:open`, section: f.section, label: `${f.label} — not done` },
  ]);

/**
 * Done means the box is TICKED, date or no date.
 *
 * Deliberately the same rule as `depoTaken` above, and for the same reason
 * given there: `chain.js` needs `done AND occurred_on` before it will compute a
 * deadline, because a rule cannot derive a date from a date that is missing.
 * That is a different question from this one. "Which cases still need the
 * affidavits filed" is answered by the tick alone, and excluding an item
 * somebody ticked without recording the date would hide work that is genuinely
 * done.
 *
 * Two filters that look alike must not disagree.
 */
export function matchesChecklist(matter, filter) {
  if (!filter) return true;

  const [key, state] = String(filter).split(':');
  if (!key || !state) return true;

  const done = Boolean(matter?.values?.[key]?.done);
  if (state === 'done') return done;
  if (state === 'open') return !done;
  return true;
}

/* ------------------------------------------------------------------ *
 * Everything at once
 * ------------------------------------------------------------------ */

/**
 * @returns {{id, matter, stale}[]} filtered and sorted, ready to page.
 */
export function buildCaseList(matters = {}, {
  q = '', status = '', attorney = '', caseType = '', depo = '', checklist = '',
  showArchived = false, sort = 'activity', direction = 'asc',
} = {}) {

  const rows = Object.entries(matters)
    .filter(([, m]) => (showArchived ? true : !m?.archivedAt))
    .filter(([, m]) => (status ? (m?.values?.status || '') === status : true))
    .filter(([, m]) => (attorney ? (m?.values?.attorney || '') === attorney : true))
    .filter(([, m]) => matchesCaseType(m, caseType))
    .filter(([, m]) => matchesDepo(m, depo))
    .filter(([, m]) => matchesChecklist(m, checklist))
    .filter(([, m]) => matchesCaseSearch(m?.values, q))
    .map(([id, m]) => ({ id, matter: m, stale: daysSinceActivity(m) }));

  return sortRows(rows, sort, direction);
}
