import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SORTS, CASE_TYPES, DEPO_FILTERS,
  sortRows, matchesCaseType, matchesDepo, buildCaseList, directionLabel, CHECKLIST_FILTERS, matchesChecklist,
} from '@/lib/domain/case-list';

const m = (values = {}, extra = {}) => ({ values, ...extra });
const row = (caseNumber, clientName, stale) => ({
  id: caseNumber || clientName,
  matter: m({ caseNumber, clientName }),
  stale,
});

/* ------------------------------------------------------------------ *
 * Sorting
 * ------------------------------------------------------------------ */

test('case numbers order chronologically as plain strings', () => {
  const rows = [row('26-101', 'C'), row('16-529', 'A'), row('21-064', 'B')];
  assert.deepEqual(
    sortRows(rows, 'caseNumber').map((r) => r.matter.values.caseNumber),
    ['16-529', '21-064', '26-101'],
  );
});

test('a case with NO number sorts last, not first', () => {
  // Missing is not "before 16-001". Sorting it to the top would put the
  // least-identifiable cases where the eye lands first.
  const rows = [row('', 'No number'), row('21-064', 'Has one')];
  assert.deepEqual(sortRows(rows, 'caseNumber').map((r) => r.matter.values.clientName),
    ['Has one', 'No number']);
});

test('A–Z is by the title the firm reads, surname first', () => {
  const rows = [row('26-003', 'Zamora, Ana'), row('26-001', 'Alvarez, Bo'), row('26-002', 'Marsh, Cy')];
  assert.deepEqual(
    sortRows(rows, 'name').map((r) => r.matter.values.clientName),
    ['Alvarez, Bo', 'Marsh, Cy', 'Zamora, Ana'],
  );
});

test('A–Z ignores case, and orders digits numerically', () => {
  const rows = [row('1', 'baker, al'), row('2', 'Baker, Al 10'), row('3', 'Baker, Al 2')];
  const out = sortRows(rows, 'name').map((r) => r.matter.values.clientName);
  assert.equal(out[0], 'baker, al');
  assert.deepEqual(out.slice(1), ['Baker, Al 2', 'Baker, Al 10']);
});

test('last activity leads, and a case with none goes last', () => {
  const rows = [row('a', 'Old', 90), row('b', 'Never', null), row('c', 'Fresh', 1)];
  assert.deepEqual(sortRows(rows, 'activity').map((r) => r.matter.values.clientName),
    ['Fresh', 'Old', 'Never']);
});

test('ties break by name, so rows do not swap between renders', () => {
  const rows = [row('26-002', 'Zed', 5), row('26-001', 'Abe', 5)];
  assert.deepEqual(sortRows(rows, 'activity').map((r) => r.matter.values.clientName), ['Abe', 'Zed']);
});

test('sortRows does not mutate what it was given', () => {
  const rows = [row('26-002', 'B', 2), row('26-001', 'A', 1)];
  const before = rows.map((r) => r.id);
  sortRows(rows, 'name');
  assert.deepEqual(rows.map((r) => r.id), before);
});

test('every sort key in SORTS is handled', () => {
  const rows = [row('26-002', 'B', 2), row('26-001', 'A', 1)];
  for (const s of SORTS) assert.equal(sortRows(rows, s.key).length, 2, s.key);
});

/* ------------------------------------------------------------------ *
 * Case type
 * ------------------------------------------------------------------ */

test('case type matches the Commercial / Personal Lines field', () => {
  assert.ok(matchesCaseType(m({ commercial: 'Commercial' }), 'Commercial'));
  assert.ok(!matchesCaseType(m({ commercial: 'Personal Lines' }), 'Commercial'));
});

test('A BLANK COUNTS AS UNKNOWN', () => {
  /*
   * The field offers Unknown as a choice, so a case reaches it two ways:
   * somebody picked it, or nobody touched the field. On 359 imported cases
   * almost all are the second, and a filter returning four while 355 sit
   * unclassified would read as broken.
   */
  assert.ok(matchesCaseType(m({}), 'Unknown'));
  assert.ok(matchesCaseType(m({ commercial: '' }), 'Unknown'));
  assert.ok(matchesCaseType(m({ commercial: '   ' }), 'Unknown'));
  assert.ok(matchesCaseType(m({ commercial: 'Unknown' }), 'Unknown'));
  assert.ok(!matchesCaseType(m({ commercial: 'Commercial' }), 'Unknown'));
});

test('no case-type filter matches everything', () => {
  assert.ok(matchesCaseType(m({}), ''));
  assert.ok(matchesCaseType(m({ commercial: 'Commercial' }), ''));
});

test('the offered types are the field\'s own options', () => {
  assert.ok(CASE_TYPES.includes('Commercial'));
  assert.ok(CASE_TYPES.includes('Personal Lines'));
  assert.ok(CASE_TYPES.includes('Unknown'));
});

/* ------------------------------------------------------------------ *
 * Depositions
 * ------------------------------------------------------------------ */

const plOnly = m({ plDepo: { done: true }, defDepo: { done: false } });
const defOnly = m({ plDepo: { done: false }, defDepo: { done: true } });
const both = m({ plDepo: { done: true }, defDepo: { done: true } });
const none = m({});

test('each deposition filter selects what it says', () => {
  assert.deepEqual(
    [plOnly, defOnly, both, none].map((x) => matchesDepo(x, 'pl')),
    [true, false, true, false],
  );
  assert.deepEqual(
    [plOnly, defOnly, both, none].map((x) => matchesDepo(x, 'def')),
    [false, true, true, false],
  );
  assert.deepEqual(
    [plOnly, defOnly, both, none].map((x) => matchesDepo(x, 'either')),
    [true, true, true, false],
  );
  assert.deepEqual(
    [plOnly, defOnly, both, none].map((x) => matchesDepo(x, 'neither')),
    [false, false, false, true],
  );
});

test('ticked with no date still counts as taken', () => {
  /*
   * chain.js needs `done AND occurred_on` before it will compute a deadline,
   * and is right to. This is a different question — "who still needs deposing"
   * — and excluding a deposition recorded without its date would hide work
   * that genuinely happened.
   */
  assert.ok(matchesDepo(m({ plDepo: { done: true, date: '' } }), 'pl'));
});

test('an untouched matter counts as no depo taken', () => {
  assert.ok(matchesDepo(none, 'neither'));
  assert.ok(matchesDepo(m({ plDepo: {} }), 'neither'));
});

test('every filter key in DEPO_FILTERS is handled', () => {
  for (const f of DEPO_FILTERS) assert.equal(typeof matchesDepo(both, f.key), 'boolean', f.key);
});

/* ------------------------------------------------------------------ *
 * Together
 * ------------------------------------------------------------------ */

const CASES = {
  a: m({ clientName: 'Alvarez, Bo', caseNumber: '21-064', attorney: 'Dana', status: 'Open',
         commercial: 'Commercial', plDepo: { done: true } }),
  b: m({ clientName: 'Marsh, Cy', caseNumber: '26-101', attorney: 'Paul', status: 'Open' }),
  c: m({ clientName: 'Zamora, Ana', caseNumber: '16-529', attorney: 'Dana', status: 'Closed',
         commercial: 'Personal Lines', defDepo: { done: true } }),
  d: m({ clientName: 'Gone, Case', caseNumber: '26-002' }, { archivedAt: '2026-01-01' }),
};

test('archived cases are hidden unless asked for', () => {
  assert.equal(buildCaseList(CASES).length, 3);
  assert.equal(buildCaseList(CASES, { showArchived: true }).length, 4);
});

test('filters compose, and the result is sorted', () => {
  const out = buildCaseList(CASES, { attorney: 'Dana', sort: 'caseNumber' });
  assert.deepEqual(out.map((r) => r.matter.values.caseNumber), ['16-529', '21-064']);
});

test('case type and deposition narrow together', () => {
  assert.deepEqual(
    buildCaseList(CASES, { caseType: 'Commercial', depo: 'pl' }).map((r) => r.id), ['a']);
  assert.deepEqual(
    buildCaseList(CASES, { caseType: 'Commercial', depo: 'def' }).map((r) => r.id), []);
});

test('the unknown filter finds the cases nobody has classified', () => {
  // Marsh has no `commercial` at all — the state 343 imported cases start in.
  assert.deepEqual(buildCaseList(CASES, { caseType: 'Unknown' }).map((r) => r.id), ['b']);
});

test('"no depo taken yet" is the list of cases still needing one', () => {
  assert.deepEqual(buildCaseList(CASES, { depo: 'neither' }).map((r) => r.id), ['b']);
});

test('search still matches name or case number', () => {
  assert.deepEqual(buildCaseList(CASES, { q: 'zamora' }).map((r) => r.id), ['c']);
  assert.deepEqual(buildCaseList(CASES, { q: '26-101' }).map((r) => r.id), ['b']);
});

test('no filters at all returns everything live', () => {
  assert.equal(buildCaseList(CASES, {}).length, 3);
  assert.equal(buildCaseList({}).length, 0);
});

/* ------------------------------------------------------------------ *
 * Sort direction
 * ------------------------------------------------------------------ */

test('descending reverses each sort', () => {
  const rows = [row('26-101', 'C', 1), row('16-529', 'A', 3), row('21-064', 'B', 2)];
  assert.deepEqual(sortRows(rows, 'caseNumber', 'desc').map((r) => r.matter.values.caseNumber),
    ['26-101', '21-064', '16-529']);
  assert.deepEqual(sortRows(rows, 'name', 'desc').map((r) => r.matter.values.clientName),
    ['C', 'B', 'A']);
  assert.deepEqual(sortRows(rows, 'activity', 'desc').map((r) => r.matter.values.clientName),
    ['A', 'B', 'C']);
});

test('MISSING VALUES STAY LAST IN BOTH DIRECTIONS', () => {
  /*
   * The bug the obvious implementation has. Negating the whole comparator
   * reverses everything including the missing rows, so flipping to descending
   * surfaces the six folders nobody numbered instead of 26-101. A case with
   * no number is not the highest number; it is missing.
   */
  const rows = [row('26-101', 'Has one', 1), row('', 'No number', 2), row('16-529', 'Also has', 3)];
  for (const dir of ['asc', 'desc']) {
    const out = sortRows(rows, 'caseNumber', dir).map((r) => r.matter.values.clientName);
    assert.equal(out[out.length - 1], 'No number', `missing should be last when ${dir}`);
  }
});

test('a case with no activity stays last when the order is reversed', () => {
  const rows = [row('a', 'Fresh', 1), row('b', 'Never', null), row('c', 'Old', 90)];
  for (const dir of ['asc', 'desc']) {
    const out = sortRows(rows, 'activity', dir).map((r) => r.matter.values.clientName);
    assert.equal(out[out.length - 1], 'Never', `missing should be last when ${dir}`);
  }
});

test('ties follow the direction rather than staying ascending', () => {
  const rows = [row('26-001', 'Abe', 5), row('26-002', 'Zed', 5)];
  assert.deepEqual(sortRows(rows, 'activity', 'asc').map((r) => r.matter.values.clientName),
    ['Abe', 'Zed']);
  assert.deepEqual(sortRows(rows, 'activity', 'desc').map((r) => r.matter.values.clientName),
    ['Zed', 'Abe']);
});

test('an unknown direction is treated as ascending', () => {
  const rows = [row('26-002', 'B', 2), row('26-001', 'A', 1)];
  assert.deepEqual(sortRows(rows, 'caseNumber').map((r) => r.matter.values.caseNumber),
    ['26-001', '26-002']);
  assert.deepEqual(sortRows(rows, 'caseNumber', 'sideways').map((r) => r.matter.values.caseNumber),
    ['26-001', '26-002']);
});

test('the direction label speaks in terms of the current sort', () => {
  // "Descending" makes a reader work out what that means for a case number.
  assert.equal(directionLabel('name', 'asc'), 'A–Z');
  assert.equal(directionLabel('name', 'desc'), 'Z–A');
  assert.equal(directionLabel('caseNumber', 'asc'), 'Oldest number first');
  assert.equal(directionLabel('caseNumber', 'desc'), 'Newest number first');
  assert.equal(directionLabel('activity', 'asc'), 'Most recent first');
  assert.equal(directionLabel('activity', 'desc'), 'Least recent first');
});

test('buildCaseList passes the direction through', () => {
  const numbers = (dir) => buildCaseList(CASES, { sort: 'caseNumber', direction: dir })
    .map((r) => r.matter.values.caseNumber);
  assert.deepEqual(numbers('asc'), ['16-529', '21-064', '26-101']);
  assert.deepEqual(numbers('desc'), ['26-101', '21-064', '16-529']);
});

/* ------------------------------------------------------------------ *
 * Checklist filters
 * ------------------------------------------------------------------ */

const ticked = (key, extra = {}) => ({ values: { [key]: { done: true, ...extra } } });

test('there is a done and a not-done option for all 13 checklist items', () => {
  // Derived from FIELDS, so this also fails if somebody adds a checklist item
  // and the filter list silently does not grow with it.
  assert.equal(CHECKLIST_FILTERS.length, 26);
  const sections = new Set(CHECKLIST_FILTERS.map((c) => c.section));
  assert.deepEqual(
    [...sections].sort(),
    ['Depositions', 'Discovery', 'Medicals', 'Negotiations', 'Pleading'],
  );
});

test('the four the firm asked for by name are all filterable', () => {
  const keys = CHECKLIST_FILTERS.map((c) => c.key);
  for (const k of [
    'plDiscoveryAnswered:done', 'defDiscoveryAnswered:done',
    'plDiscoverySent:done', 'mediation:done', 'affidavitsFiled:done',
  ]) {
    assert.ok(keys.includes(k), `missing filter: ${k}`);
  }
});

test('done means the box is ticked, with or without a date', () => {
  /*
   * The same rule as the deposition filter, deliberately. chain.js needs
   * `done AND occurred_on` before it computes a deadline, because a rule
   * cannot derive a date from a missing one -- but "which cases still need
   * affidavits filed" is answered by the tick alone. Excluding an item someone
   * ticked without recording the date would hide work that is genuinely done.
   */
  assert.equal(matchesChecklist(ticked('affidavitsFiled'), 'affidavitsFiled:done'), true);
  assert.equal(matchesChecklist(ticked('affidavitsFiled', { date: '2026-03-01' }), 'affidavitsFiled:done'), true);
});

test('not-done catches unticked, absent and malformed alike', () => {
  // A case that has never had the Medicals tab opened has no key at all, and
  // must still answer "not done" rather than being dropped from both sides.
  assert.equal(matchesChecklist({ values: { affidavitsFiled: { done: false } } }, 'affidavitsFiled:open'), true);
  assert.equal(matchesChecklist({ values: {} }, 'affidavitsFiled:open'), true);
  assert.equal(matchesChecklist({}, 'affidavitsFiled:open'), true);
  assert.equal(matchesChecklist(undefined, 'affidavitsFiled:open'), true);
  assert.equal(matchesChecklist({ values: {} }, 'affidavitsFiled:done'), false);
});

test('an unset or unparseable filter matches everything', () => {
  // The facet stores '' when unset, and a stale bookmarked value must not
  // empty the case list.
  for (const f of ['', null, undefined, 'garbage', 'affidavitsFiled', ':done']) {
    assert.equal(matchesChecklist(ticked('affidavitsFiled'), f), true, JSON.stringify(f));
  }
});

test('buildCaseList filters by a checklist item', () => {
  const matters = {
    m1: { values: { clientName: 'Aguilar, Carlos', caseNumber: '23-180', affidavitsFiled: { done: true } } },
    m2: { values: { clientName: 'Gomez, Sylvia', caseNumber: '22-006' } },
  };
  assert.deepEqual(buildCaseList(matters, { checklist: 'affidavitsFiled:done' }).map((r) => r.id), ['m1']);
  assert.deepEqual(buildCaseList(matters, { checklist: 'affidavitsFiled:open' }).map((r) => r.id), ['m2']);
  assert.equal(buildCaseList(matters, { checklist: '' }).length, 2);
});
