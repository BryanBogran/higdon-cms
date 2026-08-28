import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PHASES, PHASE_BY_KEY, PHASE_TASK_FLOWS,
  tasksForPhase, phaseTaskId, resolveRole, phaseFlowPreview,
} from './phases.js';

test('entering a phase creates its tasks', () => {
  const created = tasksForPhase('M1', 'treatment', { attorney: 'MA' }, {}, '2026-08-27');
  assert.equal(created.length, 3);
  const titles = created.map((t) => t.title);
  assert.ok(titles.some((t) => /Request medical records/.test(t)));
  assert.ok(titles.some((t) => /health insurance/i.test(t)));
});

test('re-entering a phase creates NOTHING — idempotent by id', () => {
  const first = tasksForPhase('M1', 'treatment', {}, {}, '2026-08-27');
  const existing = Object.fromEntries(first.map((t) => [t.id, t]));

  const second = tasksForPhase('M1', 'treatment', {}, existing, '2026-08-27');
  assert.equal(second.length, 0, 'no duplicates on a second entry');

  // Even a year later, with the tasks completed.
  for (const id of Object.keys(existing)) existing[id] = { ...existing[id], completed: true };
  const third = tasksForPhase('M1', 'treatment', {}, existing, '2027-08-27');
  assert.equal(third.length, 0, 'completed tasks are not recreated');
});

test('partially completed flows create only the missing tasks', () => {
  const all = tasksForPhase('M1', 'treatment', {}, {}, '2026-08-27');
  const existing = { [all[0].id]: all[0] };           // one of three exists
  const created = tasksForPhase('M1', 'treatment', {}, existing, '2026-08-27');
  assert.equal(created.length, 2);
  assert.ok(!created.some((t) => t.id === all[0].id));
});

test('due dates are measured from the day the phase is entered', () => {
  const created = tasksForPhase('M1', 'treatment', {}, {}, '2026-08-27');
  const records = created.find((t) => /Request medical records/.test(t.title));
  assert.equal(records.dueDate, '2026-09-10', '14 days out');

  const later = tasksForPhase('M2', 'treatment', {}, {}, '2026-10-01');
  const records2 = later.find((t) => /Request medical records/.test(t.title));
  assert.equal(records2.dueDate, '2026-10-15', 'relative to entry, not to a fixed date');
});

test('assignment resolves by role, falling back to Unassigned rather than guessing', () => {
  assert.equal(resolveRole('attorney', { attorney: 'Priya Raman' }), 'Priya Raman');
  assert.equal(resolveRole('paralegal', { attorney: 'Priya Raman' }), 'Unassigned',
    'does not fall back to the attorney -- a wrong assignee hides, an empty one does not');
  assert.equal(resolveRole('accounting', {}), 'Unassigned');

  const created = tasksForPhase('M1', 'demand', { attorney: 'Priya Raman' }, {}, '2026-08-27');
  const draft = created.find((t) => /Draft demand/.test(t.title));
  assert.equal(draft.assignedTo, 'Priya Raman');
});

test('every generated task carries the confirm-with-attorney note', () => {
  for (const phase of Object.keys(PHASE_TASK_FLOWS)) {
    for (const t of tasksForPhase('M1', phase, {}, {}, '2026-08-27')) {
      assert.match(t.note, /Confirm with attorney\./, `${phase}/${t.title}`);
      assert.equal(t.source, 'flow');
      assert.equal(t.phaseKey, phase);
    }
  }
});

test('a phase with no flow yields nothing, and unknown phases do not throw', () => {
  assert.deepEqual(tasksForPhase('M1', 'pnc', {}, {}, '2026-08-27'), []);
  assert.deepEqual(tasksForPhase('M1', 'nonsense', {}, {}, '2026-08-27'), []);
});

test('preview reports what a phase move would actually do', () => {
  const before = phaseFlowPreview('M1', 'treatment', {});
  assert.equal(before.total, 3);
  assert.equal(before.willCreate, 3);

  const all = tasksForPhase('M1', 'treatment', {}, {}, '2026-08-27');
  const existing = Object.fromEntries(all.map((t) => [t.id, t]));
  const after = phaseFlowPreview('M1', 'treatment', existing);
  assert.equal(after.willCreate, 0, 'nothing new to create');
  assert.equal(after.total, 3, 'but the flow still has three');
});

test('phases are well formed and every flow references a real phase', () => {
  assert.ok(PHASES.length >= 5);
  for (const p of PHASES) {
    assert.ok(p.key && p.label && p.description, `${p.key} is complete`);
  }
  for (const key of Object.keys(PHASE_TASK_FLOWS)) {
    assert.ok(PHASE_BY_KEY[key], `flow "${key}" targets a real phase`);
  }
  assert.equal(phaseTaskId('M1', 'treatment', 'x'), 'flow:M1:treatment:x');
});
