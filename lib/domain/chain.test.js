import test from 'node:test';
import assert from 'node:assert/strict';

import { CHAIN_RULES, generateChainTasks, autoTaskId } from './chain.js';
import { emptyValues } from './fields.js';

/** A matter map with one matter, `M1`, whose values are overridden. */
function oneMatter(overrides = {}) {
  return { M1: { values: { ...emptyValues(), ...overrides } } };
}

/** A done checklist item with a trigger date. */
const done = (date) => ({ done: true, docUrl: '', note: '', date });

test('every rule keeps its citation and the confirm-with-attorney guardrail', () => {
  assert.equal(CHAIN_RULES.length, 8);

  const statutory = ['served', 'plDiscoverySent', 'defDiscoveryReceived'];
  for (const key of statutory) {
    const rule = CHAIN_RULES.find((r) => r.key === key);
    assert.match(rule.note, /Tex\. R\. Civ\. P\./, `${key} cites its rule`);
    assert.match(rule.note, /Confirm with attorney\./, `${key} carries the guardrail`);
  }

  // Exact strings, so a well-meaning reword shows up as a failing test.
  assert.equal(
    CHAIN_RULES.find((r) => r.key === 'served').note,
    'Tex. R. Civ. P. 99 — Monday next after 20 days from service. Confirm with attorney.'
  );
  assert.equal(
    CHAIN_RULES.find((r) => r.key === 'plDiscoverySent').note,
    'Tex. R. Civ. P. 196/197 — 30 days. Confirm with attorney.'
  );
});

test('Rule 99: served produces a Monday answer-due date', () => {
  const tasks = generateChainTasks(oneMatter({ served: done('2026-08-27') }));
  const t = tasks[autoTaskId('M1', 'served')];

  assert.ok(t, 'task generated');
  assert.equal(t.title, 'Answer Due');
  assert.equal(t.dueDate, '2026-09-21', 'Aug 27 + 20d = Sep 16 (Wed) -> Mon Sep 21');
  assert.equal(t.autoDueDate, '2026-09-21');
  assert.equal(t.source, 'auto');
  assert.equal(t.ruleKey, 'served');
  assert.equal(t.completed, false);
  assert.equal(t.manualOverride, false);
});

test('the +30 and +14 day rules', () => {
  const a = generateChainTasks(oneMatter({ plDiscoverySent: done('2026-08-27') }));
  assert.equal(a[autoTaskId('M1', 'plDiscoverySent')].dueDate, '2026-09-26');

  const b = generateChainTasks(oneMatter({ defDiscoveryReceived: done('2026-08-27') }));
  assert.equal(b[autoTaskId('M1', 'defDiscoveryReceived')].dueDate, '2026-09-26');

  const c = generateChainTasks(oneMatter({ recordsOrdered: done('2026-08-27') }));
  assert.equal(c[autoTaskId('M1', 'recordsOrdered')].dueDate, '2026-09-26');

  const d = generateChainTasks(oneMatter({ plDepo: done('2026-08-27') }));
  assert.equal(d[autoTaskId('M1', 'plDepo')].dueDate, '2026-09-10');
});

test('passthrough rules read straight off the matter record', () => {
  const tasks = generateChainTasks(
    oneMatter({ sol: '2027-03-01', trialDate: '2026-10-06', dco: '2026-09-15' })
  );
  assert.equal(tasks[autoTaskId('M1', 'sol')].dueDate, '2027-03-01');
  assert.equal(tasks[autoTaskId('M1', 'trialDate')].dueDate, '2026-10-06');
  assert.equal(tasks[autoTaskId('M1', 'dco')].dueDate, '2026-09-15');
});

test('a checklist item marked done with NO date generates nothing', () => {
  // This is the deceptive failure the CSV import created: five of eight rules
  // gate on `done && date`, so importing `served: Y` with no date produced a
  // populated-looking task list with no Answer Due deadline in it.
  const tasks = generateChainTasks(
    oneMatter({
      served: { done: true, docUrl: '', note: '', date: '' },
      plDiscoverySent: { done: true, docUrl: '', note: '', date: '' },
    })
  );
  assert.equal(Object.keys(tasks).length, 0, 'no date means no deadline, silently');
});

test('regeneration is idempotent and updates in place', () => {
  const m = oneMatter({ served: done('2026-08-27') });

  const first = generateChainTasks(m);
  const second = generateChainTasks(m, first);
  const third = generateChainTasks(m, second);

  assert.equal(Object.keys(third).length, 1, 'never duplicates');
  assert.deepEqual(second, third, 'stable across runs');

  // Move the trigger date; the task updates rather than a second one appearing.
  const moved = generateChainTasks(oneMatter({ served: done('2026-09-03') }), third);
  assert.equal(Object.keys(moved).length, 1);
  assert.equal(moved[autoTaskId('M1', 'served')].dueDate, '2026-09-28');
});

test('completion, assignment, and calendar-sync survive regeneration', () => {
  const m = oneMatter({ served: done('2026-08-27'), attorney: 'MA' });
  let tasks = generateChainTasks(m);
  const id = autoTaskId('M1', 'served');

  assert.equal(tasks[id].assignedTo, 'MA', 'defaults to the matter attorney');

  tasks[id] = { ...tasks[id], completed: true, calendarSynced: true, assignedTo: 'DD' };
  tasks = generateChainTasks(m, tasks);

  assert.equal(tasks[id].completed, true, 'completion is sticky');
  assert.equal(tasks[id].calendarSynced, true, 'calendar sync is sticky');
  assert.equal(tasks[id].assignedTo, 'DD', 'a reassignment is not overwritten');
});

test('assignedTo falls back to the literal "Unassigned"', () => {
  const tasks = generateChainTasks(oneMatter({ served: done('2026-08-27') }));
  assert.equal(tasks[autoTaskId('M1', 'served')].assignedTo, 'Unassigned');
});

test('manualOverride keeps the human date and still tracks the computed one', () => {
  const m = oneMatter({ served: done('2026-08-27') });
  let tasks = generateChainTasks(m);
  const id = autoTaskId('M1', 'served');

  // An attorney disagrees with the computed date and sets their own.
  tasks[id] = { ...tasks[id], manualOverride: true, dueDate: '2026-09-30' };
  tasks = generateChainTasks(m, tasks);

  assert.equal(tasks[id].dueDate, '2026-09-30', 'the human date wins');
  assert.equal(tasks[id].autoDueDate, '2026-09-21', 'the computed date is still recorded');

  // Moving the trigger updates autoDueDate but must not stomp the override.
  tasks = generateChainTasks(oneMatter({ served: done('2026-09-03') }), tasks);
  assert.equal(tasks[id].dueDate, '2026-09-30', 'override survives a trigger change');
  assert.equal(tasks[id].autoDueDate, '2026-09-28', 'auto date follows the trigger');
});

test('a retracted trigger deletes the task — unless completed or overridden', () => {
  const withTrigger = oneMatter({ served: done('2026-08-27') });
  const id = autoTaskId('M1', 'served');

  // Plain case: un-mark served, the task goes.
  let tasks = generateChainTasks(withTrigger);
  tasks = generateChainTasks(oneMatter({}), tasks);
  assert.equal(tasks[id], undefined, 'deleted when the trigger disappears');

  // Completed tasks are kept — the work happened, the record stays.
  tasks = generateChainTasks(withTrigger);
  tasks[id] = { ...tasks[id], completed: true };
  tasks = generateChainTasks(oneMatter({}), tasks);
  assert.ok(tasks[id], 'a completed task is not deleted');

  // Manually overridden tasks are kept — a human asserted this deadline exists.
  tasks = generateChainTasks(withTrigger);
  tasks[id] = { ...tasks[id], manualOverride: true, dueDate: '2026-10-01' };
  tasks = generateChainTasks(oneMatter({}), tasks);
  assert.ok(tasks[id], 'an overridden task is not deleted');
});

test('badDate flags weekends and holidays without moving the date', () => {
  // Christmas Day 2026 is a Friday. Set it as a DCO and the warning should fire.
  const tasks = generateChainTasks(oneMatter({ dco: '2026-12-25' }));
  const t = tasks[autoTaskId('M1', 'dco')];
  assert.equal(t.dueDate, '2026-12-25', 'the date is NOT adjusted');
  assert.equal(t.badDate, 'Christmas Day', 'but it is flagged');

  const sat = generateChainTasks(oneMatter({ trialDate: '2026-08-29' }));
  assert.equal(sat[autoTaskId('M1', 'trialDate')].badDate, 'Saturday');

  const fine = generateChainTasks(oneMatter({ trialDate: '2026-08-27' }));
  assert.equal(fine[autoTaskId('M1', 'trialDate')].badDate, null);
});

test('multiple matters and multiple rules stay independent', () => {
  const matters = {
    M1: { values: { ...emptyValues(), served: done('2026-08-27'), sol: '2027-01-01' } },
    M2: { values: { ...emptyValues(), plDepo: done('2026-08-27') } },
    M3: { values: { ...emptyValues() } },
  };

  const tasks = generateChainTasks(matters);
  assert.equal(Object.keys(tasks).length, 3, 'M1 -> 2 tasks, M2 -> 1, M3 -> none');
  assert.ok(tasks[autoTaskId('M1', 'served')]);
  assert.ok(tasks[autoTaskId('M1', 'sol')]);
  assert.ok(tasks[autoTaskId('M2', 'plDepo')]);
  assert.equal(tasks[autoTaskId('M2', 'served')], undefined);
});

test('tolerates empty and malformed input without throwing', () => {
  assert.deepEqual(generateChainTasks({}), {});
  assert.deepEqual(generateChainTasks(null), {});
  assert.deepEqual(generateChainTasks(undefined), {});
  assert.deepEqual(generateChainTasks({ M1: {} }), {});
  assert.deepEqual(generateChainTasks({ M1: { values: null } }), {});

  // An unparseable imported date must not produce a task with a garbage due date.
  const tasks = generateChainTasks(oneMatter({ sol: '3/1/24' }));
  const t = tasks[autoTaskId('M1', 'sol')];
  assert.equal(t.dueDate, '3/1/24', 'the raw value is passed through as-is');
  assert.equal(t.badDate, null, 'and cannot be assessed, rather than guessed at');
});
