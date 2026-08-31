import test from 'node:test';
import assert from 'node:assert/strict';
import { daysSinceActivity, isStale, matterTitle } from './matter.js';
import { instantToFirmDate } from './dates.js';

/*
 * These run under TZ=UTC, Pacific/Auckland and Pacific/Honolulu (see the test
 * script). Every expectation below must hold in all three, because the firm's
 * calendar day is Central regardless of where the machine is.
 */

test('a matter touched this evening is not "-1d ago"', () => {
  // 2026-08-30 21:00 Central is 2026-08-31 02:00 UTC. Slicing the timestamp
  // would call that August 31st and report -1 against a Central "today" of
  // August 30th.
  const matter = { lastActivityAt: '2026-08-31T02:00:00.000Z' };
  assert.equal(daysSinceActivity(matter, '2026-08-30'), 0);
});

test('the same instant one day earlier is 1 day ago', () => {
  const matter = { lastActivityAt: '2026-08-30T02:00:00.000Z' };
  assert.equal(daysSinceActivity(matter, '2026-08-30'), 1);
});

test('daysSinceActivity is never negative for a past stamp', () => {
  // Every hour of a Central day, against that same Central day.
  for (let h = 0; h < 24; h++) {
    const stamp = `2026-08-30T${String(h).padStart(2, '0')}:00:00.000Z`;
    const today = instantToFirmDate(stamp);
    const d = daysSinceActivity({ lastActivityAt: stamp }, today);
    assert.ok(d >= 0, `${stamp} against ${today} gave ${d}`);
  }
});

test('falls back to openDate when there is no activity stamp', () => {
  assert.equal(daysSinceActivity({ values: { openDate: '2026-08-20' } }, '2026-08-30'), 10);
});

test('returns null when there is nothing to measure', () => {
  assert.equal(daysSinceActivity({}, '2026-08-30'), null);
});

test('instantToFirmDate rejects junk rather than returning NaN', () => {
  assert.equal(instantToFirmDate('not a date'), null);
  assert.equal(instantToFirmDate(''), null);
  assert.equal(instantToFirmDate(null), null);
  assert.equal(instantToFirmDate(undefined), null);
});

test('instantToFirmDate pins to Central, not the machine zone', () => {
  // 05:30 UTC is still the previous evening in Houston.
  assert.equal(instantToFirmDate('2026-08-31T04:30:00.000Z'), '2026-08-30');
  // 06:30 UTC has crossed midnight Central (CDT, UTC-5).
  assert.equal(instantToFirmDate('2026-08-31T05:30:00.000Z'), '2026-08-31');
});

test('staleness is measured from the firm day, so it cannot go negative', () => {
  const fresh = { values: { status: 'Open' }, lastActivityAt: '2026-08-31T02:00:00.000Z' };
  assert.equal(isStale(fresh, '2026-08-30'), false);
});

test('matterTitle says so when there is no case number', () => {
  assert.equal(matterTitle({ values: { clientName: 'Rivera, Marcus' } }), 'Rivera, Marcus (no case #)');
  assert.equal(
    matterTitle({ values: { clientName: 'Rivera, Marcus', caseNumber: '26-001' } }),
    'Rivera, Marcus 26-001',
  );
});
