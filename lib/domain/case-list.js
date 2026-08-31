/**
 * Filtering and sorting the case list.
 *
 * Pulled out of the Project Hub page because these are rules, not rendering:
 * what counts as an unknown insurance class, how a case number orders against
 * a case with none, whether a deposition marked done with no date counts as
 * taken. Each is a decision, each is one line to get wrong, and none of them
 * can be tested inside a React component.
 */

import { FIELD_BY_KEY } from '@/lib/domain/fields';
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
 *
 * A case with NO number always sorts last, in both directions. It is not
 * "before 16-001"; it is missing, and burying it at the top of a descending
 * list would be the same bug as showing it first.
 */
function compareCaseNumber(a, b) {
  const x = String(a?.matter?.values?.caseNumber || '').trim();
  const y = String(b?.matter?.values?.caseNumber || '').trim();
  if (!x && !y) return 0;
  if (!x) return 1;
  if (!y) return -1;
  return x.localeCompare(y);
}

/** Surname-first, which is how the firm reads and files a list of clients. */
function compareName(a, b) {
  return matterTitle(a?.matter).localeCompare(matterTitle(b?.matter), undefined, {
    sensitivity: 'base',
    numeric: true,
  });
}

/**
 * Most recently touched first — the default, because the question the hub
 * usually answers is "what is moving".
 *
 * A matter with no activity at all sorts last rather than as "0 days ago".
 */
function compareActivity(a, b) {
  return (a?.stale ?? Number.MAX_SAFE_INTEGER) - (b?.stale ?? Number.MAX_SAFE_INTEGER);
}

export function sortRows(rows = [], sort = 'activity') {
  const cmp = sort === 'name' ? compareName
    : sort === 'caseNumber' ? compareCaseNumber
    : compareActivity;
  // A stable tiebreak, so two cases with the same last-activity day do not
  // swap places between renders.
  return [...rows].sort((a, b) => cmp(a, b) || compareName(a, b));
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
 * Everything at once
 * ------------------------------------------------------------------ */

/**
 * @returns {{id, matter, stale}[]} filtered and sorted, ready to page.
 */
export function buildCaseList(matters = {}, {
  q = '', status = '', attorney = '', caseType = '', depo = '',
  showArchived = false, sort = 'activity',
} = {}) {
  const term = String(q || '').trim().toLowerCase();

  const rows = Object.entries(matters)
    .filter(([, m]) => (showArchived ? true : !m?.archivedAt))
    .filter(([, m]) => (status ? (m?.values?.status || '') === status : true))
    .filter(([, m]) => (attorney ? (m?.values?.attorney || '') === attorney : true))
    .filter(([, m]) => matchesCaseType(m, caseType))
    .filter(([, m]) => matchesDepo(m, depo))
    .filter(([, m]) => {
      if (!term) return true;
      const v = m?.values || {};
      return (
        (v.clientName || '').toLowerCase().includes(term) ||
        (v.caseNumber || '').toLowerCase().includes(term)
      );
    })
    .map(([id, m]) => ({ id, matter: m, stale: daysSinceActivity(m) }));

  return sortRows(rows, sort);
}
