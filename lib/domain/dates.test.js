/**
 * Run with:  npm test
 * And also:  TZ=Pacific/Auckland npm test     (UTC+12/13)
 *            TZ=Pacific/Honolulu npm test     (UTC-10)
 *
 * The whole point of the rewrite is that these pass identically in every zone.
 * `npm test` runs all three; a single-zone pass proves nothing.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseISO,
  isValidISO,
  toISO,
  todayInFirmTz,
  fmt,
  dayOfWeek,
  addDays,
  daysBetween,
  daysFromToday,
  nextMondayOnOrAfter,
  federalHolidays,
  getHolidayName,
  checkBadDate,
  nextBusinessDay,
  urgency,
} from './dates.js';

test('parseISO rejects anything that is not a real calendar date', () => {
  assert.equal(parseISO('2024-02-30'), null, 'Feb 30 does not exist');
  assert.equal(parseISO('2024-04-31'), null, 'Apr 31 does not exist');
  assert.equal(parseISO('2024-13-01'), null, 'month 13');
  assert.equal(parseISO('2024-00-10'), null, 'month 0');
  assert.equal(parseISO('3/1/24'), null, 'US short form is not ISO');
  assert.equal(parseISO(''), null);
  assert.equal(parseISO(null), null);
  assert.equal(parseISO(undefined), null);
  assert.equal(parseISO(42), null);
  assert.equal(parseISO('TBD'), null);

  assert.ok(parseISO('2024-02-29'), '2024 is a leap year');
  assert.equal(parseISO('2023-02-29'), null, '2023 is not');
  assert.equal(parseISO('2000-02-29')?.d, 29, 'century leap year');
  assert.equal(parseISO('1900-02-29'), null, '1900 is not a leap year');

  assert.equal(isValidISO('2026-08-27'), true);
  assert.equal(isValidISO('nope'), false);
});

test('addDays never drifts, in any timezone', () => {
  assert.equal(addDays('2026-08-27', 20), '2026-09-16');
  assert.equal(addDays('2026-08-27', 0), '2026-08-27');
  assert.equal(addDays('2026-08-27', -1), '2026-08-26');

  // Month, year, and leap boundaries
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2027-01-01', -1), '2026-12-31');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2023-02-28', 1), '2023-03-01');

  // US DST transitions in both directions. A local-time implementation loses or
  // gains an hour here and can land on the wrong calendar day.
  assert.equal(addDays('2026-03-07', 1), '2026-03-08', 'spring forward');
  assert.equal(addDays('2026-03-08', 1), '2026-03-09');
  assert.equal(addDays('2026-10-31', 1), '2026-11-01', 'fall back');
  assert.equal(addDays('2026-11-01', 1), '2026-11-02');

  // A full year of single-day steps must never skip or repeat a date.
  let cursor = '2026-01-01';
  for (let i = 0; i < 365; i++) cursor = addDays(cursor, 1);
  assert.equal(cursor, '2027-01-01', '365 single steps from 2026-01-01');

  assert.equal(addDays('bad', 5), null);
  assert.equal(addDays('2026-08-27', NaN), null);
});

test('daysBetween and daysFromToday return null rather than NaN', () => {
  assert.equal(daysBetween('2026-08-27', '2026-09-16'), 20);
  assert.equal(daysBetween('2026-09-16', '2026-08-27'), -20);
  assert.equal(daysBetween('2026-08-27', '2026-08-27'), 0);

  // DST must not produce 20.958 -> 21
  assert.equal(daysBetween('2026-03-01', '2026-03-31'), 30);
  assert.equal(daysBetween('2026-10-15', '2026-11-15'), 31);

  assert.equal(daysBetween('', '2026-01-01'), null);
  assert.equal(daysBetween('2026-01-01', 'TBD'), null);

  // The bug this guards: NaN passes every "is it safe" check.
  const d = daysFromToday(undefined);
  assert.equal(d, null);
  assert.ok(!Number.isNaN(d), 'must be null, not NaN');

  assert.equal(daysFromToday('2026-09-16', '2026-08-27'), 20);
  assert.equal(daysFromToday('2026-08-26', '2026-08-27'), -1, 'yesterday is overdue');
  assert.equal(daysFromToday('2026-08-27', '2026-08-27'), 0, 'due today is 0, not absent');
});

test('Rule 99: Monday on or after, for service on every weekday', () => {
  // 2026-08-24 is a Monday. Walk one full week of service dates.
  const cases = [
    ['2026-08-24', 'Mon'],
    ['2026-08-25', 'Tue'],
    ['2026-08-26', 'Wed'],
    ['2026-08-27', 'Thu'],
    ['2026-08-28', 'Fri'],
    ['2026-08-29', 'Sat'],
    ['2026-08-30', 'Sun'],
  ];

  for (const [served, label] of cases) {
    const twenty = addDays(served, 20);
    const due = nextMondayOnOrAfter(twenty);
    assert.equal(dayOfWeek(due), 1, `${label}: answer due must be a Monday`);
    assert.ok(daysBetween(twenty, due) >= 0, `${label}: never moves backward`);
    assert.ok(daysBetween(twenty, due) <= 6, `${label}: at most 6 days forward`);
  }

  // "on or after" is deliberate: an input Monday is returned unchanged.
  assert.equal(dayOfWeek('2026-08-24'), 1);
  assert.equal(nextMondayOnOrAfter('2026-08-24'), '2026-08-24');

  // The exact case verified against the live app in Phase 1.
  assert.equal(addDays('2026-08-27', 20), '2026-09-16');
  assert.equal(dayOfWeek('2026-09-16'), 3, 'Sep 16 2026 is a Wednesday');
  assert.equal(nextMondayOnOrAfter('2026-09-16'), '2026-09-21');

  assert.equal(nextMondayOnOrAfter('garbage'), null);
});

test('federal holidays land on the right days', () => {
  const h = federalHolidays(2026);
  assert.equal(h['2026-01-01'], "New Year's Day");
  assert.equal(h['2026-01-19'], 'Martin Luther King Jr. Day', '3rd Monday of January');
  assert.equal(h['2026-02-16'], "Presidents' Day", '3rd Monday of February');
  assert.equal(h['2026-05-25'], 'Memorial Day', 'last Monday of May');
  assert.equal(h['2026-06-19'], 'Juneteenth');
  assert.equal(h['2026-07-04'], 'Independence Day');
  assert.equal(h['2026-09-07'], 'Labor Day', '1st Monday of September');
  assert.equal(h['2026-10-12'], 'Columbus Day', '2nd Monday of October');
  assert.equal(h['2026-11-11'], 'Veterans Day');
  assert.equal(h['2026-11-26'], 'Thanksgiving', '4th Thursday of November');
  assert.equal(h['2026-11-27'], 'Day after Thanksgiving');
  assert.equal(h['2026-12-25'], 'Christmas Day');

  // Every nth-weekday holiday must actually be a Monday.
  for (const iso of ['2026-01-19', '2026-02-16', '2026-05-25', '2026-09-07', '2026-10-12']) {
    assert.equal(dayOfWeek(iso), 1, `${iso} should be a Monday`);
  }
  assert.equal(dayOfWeek('2026-11-26'), 4, 'Thanksgiving is a Thursday');

  // Observed shifting: July 4 2026 is a Saturday, observed Friday July 3.
  assert.equal(dayOfWeek('2026-07-04'), 6);
  assert.equal(h['2026-07-03'], 'Independence Day (observed)');

  // Christmas 2027 is a Saturday -> observed Friday the 24th.
  assert.equal(federalHolidays(2027)['2027-12-24'], 'Christmas Day (observed)');
  // Christmas 2022 was a Sunday -> observed Monday the 26th.
  assert.equal(federalHolidays(2022)['2022-12-26'], 'Christmas Day (observed)');

  assert.equal(getHolidayName('2026-07-04'), 'Independence Day');
  assert.equal(getHolidayName('2026-08-27'), null);
  assert.equal(getHolidayName('nope'), null);
});

test('checkBadDate warns and nextBusinessDay is the separate, explicit action', () => {
  assert.equal(checkBadDate('2026-08-29'), 'Saturday');
  assert.equal(checkBadDate('2026-08-30'), 'Sunday');
  assert.equal(checkBadDate('2026-12-25'), 'Christmas Day');
  assert.equal(checkBadDate('2026-08-27'), null, 'an ordinary Thursday');
  assert.equal(checkBadDate(''), null);

  // Saturday -> Monday
  assert.equal(nextBusinessDay('2026-08-29'), '2026-08-31');
  // Thursday Christmas 2025 -> Friday the 26th is clear
  assert.equal(nextBusinessDay('2026-12-25'), '2026-12-28', 'skips the weekend after Christmas');
  // Never returns the input, even when the input is fine
  assert.equal(nextBusinessDay('2026-08-27'), '2026-08-28');
  // Thanksgiving: skips the holiday, the day after, and the weekend
  assert.equal(nextBusinessDay('2026-11-25'), '2026-11-30');

  const nb = nextBusinessDay('2026-08-29');
  assert.equal(checkBadDate(nb), null, 'result is always a clear business day');
});

test('urgency reports unknown for a missing date, never ok', () => {
  const today = '2026-08-27';

  assert.equal(urgency(undefined, { today }).level, 'unknown');
  assert.equal(urgency('', { today }).level, 'unknown');
  assert.equal(urgency('TBD', { today }).level, 'unknown');
  assert.equal(urgency('3/1/24', { today }).level, 'unknown', 'unparsed sheet date');
  assert.equal(urgency(null, { today }).days, null);

  assert.equal(urgency('2026-08-26', { today }).level, 'overdue');
  assert.equal(urgency('2026-08-27', { today }).level, 'critical', 'due today is critical');
  assert.equal(urgency('2026-09-20', { today }).level, 'critical');
  assert.equal(urgency('2026-10-30', { today }).level, 'warning');
  assert.equal(urgency('2027-06-01', { today }).level, 'ok');

  // The regression this exists for: no missing-date input may ever read as 'ok'.
  for (const bad of [undefined, null, '', 'TBD', 'n/a', '3/1/24', 42]) {
    assert.notEqual(urgency(bad, { today }).level, 'ok', `${String(bad)} must not be ok`);
  }
});

test('todayInFirmTz resolves to the Houston calendar day, not the host zone', () => {
  const iso = todayInFirmTz();
  assert.match(iso, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(isValidISO(iso));

  // 03:00 UTC on Aug 28 is still Aug 27 in Central (UTC-5 in summer).
  assert.equal(todayInFirmTz(new Date('2026-08-28T03:00:00Z')), '2026-08-27');
  // 13:00 UTC on Aug 28 is Aug 28 in Central.
  assert.equal(todayInFirmTz(new Date('2026-08-28T13:00:00Z')), '2026-08-28');
  // Just before midnight Central on New Year's Eve.
  assert.equal(todayInFirmTz(new Date('2027-01-01T05:59:00Z')), '2026-12-31');
});

test('fmt and toISO round-trip without shifting the day', () => {
  assert.equal(fmt('2026-09-21'), 'Sep 21, 2026');
  assert.equal(fmt('2026-01-01'), 'Jan 1, 2026');
  assert.equal(fmt('2026-12-31'), 'Dec 31, 2026');
  assert.equal(fmt(''), '—');
  assert.equal(fmt('TBD'), '—');
  assert.equal(fmt(undefined, { fallback: 'not set' }), 'not set');

  assert.equal(toISO(2026, 8, 27), '2026-08-27');
  assert.equal(toISO(2026, 1, 1), '2026-01-01');
  assert.equal(toISO(Date.UTC(2026, 7, 27)), '2026-08-27');

  // Round-trip every day of a leap year through parse -> toISO.
  let cursor = '2024-01-01';
  for (let i = 0; i < 366; i++) {
    const p = parseISO(cursor);
    assert.equal(toISO(p.y, p.m, p.d), cursor, `round-trip ${cursor}`);
    cursor = addDays(cursor, 1);
  }
  assert.equal(cursor, '2025-01-01', '2024 has 366 days');
});
