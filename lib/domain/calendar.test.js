import test from 'node:test';
import assert from 'node:assert/strict';

import {
  monthOf, shiftMonth, monthLabel, daysInMonth, monthGrid, groupByDate,
  collectEvents, WEEKDAYS,
} from './calendar.js';

test('the grid is always six weeks, so the page below never jumps', () => {
  for (const m of [1, 2, 5, 8, 12]) {
    const g = monthGrid({ year: 2026, month: m });
    assert.equal(g.length, 6, `month ${m}`);
    assert.ok(g.every((w) => w.length === 7));
  }
});

test('the first of the month lands in its real weekday column', () => {
  // 2026-08-01 is a Saturday, so it is the last cell of the first row.
  const g = monthGrid({ year: 2026, month: 8 });
  assert.equal(g[0][6].date, '2026-08-01');
  assert.equal(WEEKDAYS[6], 'Sat');
  assert.equal(g[0][0].date, '2026-07-26', 'the row is padded with real dates, not blanks');
  assert.equal(g[0][0].inMonth, false);
  assert.equal(g[0][6].inMonth, true);
});

test('every day in the month appears exactly once', () => {
  const g = monthGrid({ year: 2026, month: 2 });
  const inMonth = g.flat().filter((d) => d.inMonth).map((d) => d.date);
  assert.equal(inMonth.length, 28);
  assert.equal(new Set(inMonth).size, 28, 'no duplicates');
  assert.equal(inMonth[0], '2026-02-01');
  assert.equal(inMonth[27], '2026-02-28');
});

test('leap years are handled, because Feb 29 is a real deadline', () => {
  assert.equal(daysInMonth(2028, 2), 29);
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2000, 2), 29, 'divisible by 400');
  assert.equal(daysInMonth(1900, 2), 28, 'divisible by 100 but not 400');
  const g = monthGrid({ year: 2028, month: 2 });
  assert.ok(g.flat().some((d) => d.date === '2028-02-29' && d.inMonth));
});

test('the grid does not shift with the machine timezone', () => {
  // The whole reason this module exists. Run under TZ=Pacific/Auckland and
  // TZ=Pacific/Honolulu by `npm test`; a local-time grid differs across those.
  const g = monthGrid({ year: 2026, month: 3 });
  assert.equal(g[0][0].date, '2026-03-01');
  assert.equal(g[5][6].date, '2026-04-11');
});

test('months step across the year boundary in both directions', () => {
  assert.deepEqual(shiftMonth({ year: 2026, month: 12 }, 1), { year: 2027, month: 1 });
  assert.deepEqual(shiftMonth({ year: 2026, month: 1 }, -1), { year: 2025, month: 12 });
  assert.deepEqual(shiftMonth({ year: 2026, month: 6 }, 12), { year: 2027, month: 6 });
  assert.deepEqual(shiftMonth({ year: 2026, month: 1 }, -13), { year: 2024, month: 12 });
  assert.equal(monthLabel({ year: 2026, month: 8 }), 'August 2026');
});

test('monthOf reads the month out of an ISO date', () => {
  assert.deepEqual(monthOf('2026-08-27'), { year: 2026, month: 8 });
});

test('today is marked, and only on the right square', () => {
  const g = monthGrid({ year: 2026, month: 8 }, { today: '2026-08-27' });
  const marked = g.flat().filter((d) => d.isToday);
  assert.equal(marked.length, 1);
  assert.equal(marked[0].date, '2026-08-27');
});

test('an undated item is dropped and COUNTED, never placed on a day', () => {
  // Silently putting a dateless task somewhere is how a calendar starts lying.
  const { byDate, undated } = groupByDate([
    { date: '2026-08-27', title: 'A' },
    { date: '', title: 'B' },
    { date: null, title: 'C' },
    { date: '3/1/24', title: 'D' },
  ]);
  assert.equal(undated, 3, 'including the non-ISO one');
  assert.deepEqual(Object.keys(byDate), ['2026-08-27']);
});

test('within a day, an SOL outranks a routine task', () => {
  const { byDate } = groupByDate([
    { date: '2026-08-27', title: 'Zebra task', rank: 3 },
    { date: '2026-08-27', title: 'SOL', rank: 0 },
  ]);
  assert.deepEqual(byDate['2026-08-27'].map((e) => e.title), ['SOL', 'Zebra task']);
});

test('collectEvents pulls statutory dates and open tasks, and nothing else', () => {
  const matters = {
    m1: { values: { sol: '2026-09-01', trialDate: '2026-10-15', clientName: 'A' } },
    m2: { values: { sol: '2026-09-05' }, archivedAt: '2026-01-01' },
  };
  const tasks = {
    t1: { id: 't1', matterId: 'm1', title: 'Open', dueDate: '2026-09-02', completed: false },
    t2: { id: 't2', matterId: 'm1', title: 'Done', dueDate: '2026-09-03', completed: true },
  };
  const events = collectEvents({ matters, tasks });

  assert.ok(events.some((e) => e.kind === 'sol' && e.date === '2026-09-01'));
  assert.ok(events.some((e) => e.kind === 'trialDate'));
  assert.ok(events.some((e) => e.kind === 'task' && e.id === 't1'));

  assert.ok(!events.some((e) => e.id === 't2'), 'a completed task is not upcoming');
  // An archived matter's old SOL on the calendar reads as live. It is not.
  assert.ok(!events.some((e) => e.matterId === 'm2'), 'archived matters are excluded');
});

test('collectEvents can be filtered to one kind', () => {
  const matters = { m1: { values: { sol: '2026-09-01', trialDate: '2026-10-15' } } };
  const tasks = { t1: { id: 't1', dueDate: '2026-09-02', title: 'x', completed: false } };
  const only = collectEvents({ matters, tasks, kinds: ['sol'] });
  assert.equal(only.length, 1);
  assert.equal(only[0].kind, 'sol');
});

test('empty input produces an empty calendar, not a crash', () => {
  assert.deepEqual(collectEvents({}), []);
  assert.deepEqual(groupByDate([]), { byDate: {}, undated: 0 });
});

test('an auto chain task does not double up with the date it derives from', () => {
  // The chain creates "Trial" due on the trial date. Showing both renders the
  // same fact twice on one square, in two colours, which reads as a bug.
  const matters = { m1: { values: { trialDate: '2026-09-18' } } };
  const tasks = {
    auto: { id: 'auto', matterId: 'm1', title: 'Trial', dueDate: '2026-09-18', source: 'auto', completed: false },
  };
  const events = collectEvents({ matters, tasks });
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'trialDate', 'the date survives, not the task');
});

test('a hand-written task on the same day is never dropped', () => {
  // Someone typing their own reminder for the trial date meant it.
  const matters = { m1: { values: { trialDate: '2026-09-18' } } };
  const tasks = {
    mine: { id: 'mine', matterId: 'm1', title: 'Confirm witness', dueDate: '2026-09-18', source: 'ui', completed: false },
  };
  const events = collectEvents({ matters, tasks });
  assert.equal(events.length, 2);
  assert.ok(events.some((e) => e.id === 'mine'));
});

test('an auto task on a DIFFERENT day still shows — it is a real lead time', () => {
  const matters = { m1: { values: { trialDate: '2026-09-18' } } };
  const tasks = {
    auto: { id: 'auto', matterId: 'm1', title: 'Trial prep', dueDate: '2026-09-04', source: 'auto', completed: false },
  };
  const events = collectEvents({ matters, tasks });
  assert.equal(events.length, 2);
});

test('an auto task for a different matter on the same date is not dropped', () => {
  const matters = { m1: { values: { trialDate: '2026-09-18' } }, m2: { values: {} } };
  const tasks = {
    other: { id: 'other', matterId: 'm2', title: 'Trial', dueDate: '2026-09-18', source: 'auto', completed: false },
  };
  const events = collectEvents({ matters, tasks });
  assert.equal(events.length, 2, 'the match must be on matter AND date');
});
