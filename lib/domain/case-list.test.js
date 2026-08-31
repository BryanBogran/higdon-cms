import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SORTS, CASE_TYPES, DEPO_FILTERS,
  sortRows, matchesCaseType, matchesDepo, buildCaseList, directionLabel,
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
