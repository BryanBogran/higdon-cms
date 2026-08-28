import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SEQUENCES,
  SEQUENCE_BY_KEY,
  resolveSequence,
  completeStep,
  uncompleteStep,
  skipStep,
  buildReminders,
  sequenceStepId,
} from './sequences.js';

const cmo = SEQUENCE_BY_KEY.cmo;
const byKey = (steps) => Object.fromEntries(steps.map((s) => [s.key, s]));

test('nothing is scheduled until the sequence is started', () => {
  const steps = resolveSequence('M1', cmo, {});
  assert.equal(steps.length, cmo.steps.length);
  assert.ok(steps.every((s) => s.status === 'pending'), 'all pending');
  assert.ok(steps.every((s) => s.dueDate === null), 'no dates invented');
});

test('starting the sequence schedules only the first step', () => {
  const steps = byKey(resolveSequence('M1', cmo, {}, { startedOn: '2026-08-27' }));
  assert.equal(steps['certificate-interested-parties'].status, 'active');
  assert.equal(steps['certificate-interested-parties'].dueDate, '2026-08-27', 'offset 0');
  assert.equal(steps['meet-and-confer'].status, 'pending', 'the next step waits');
  assert.equal(steps['meet-and-confer'].dueDate, null);
});

test('completing a step schedules the next one — the whole point', () => {
  let progress = {};
  progress = completeStep(cmo, progress, 'certificate-interested-parties', '2026-08-27');

  const steps = byKey(resolveSequence('M1', cmo, progress, { startedOn: '2026-08-01' }));
  assert.equal(steps['certificate-interested-parties'].status, 'done');
  assert.equal(steps['certificate-interested-parties'].completedOn, '2026-08-27');

  // 25 days after completion, per the walkthrough.
  assert.equal(steps['meet-and-confer'].status, 'active');
  assert.equal(steps['meet-and-confer'].dueDate, '2026-09-21');

  // And the one after that is still not scheduled.
  assert.equal(steps['rule-26-disclosures'].status, 'pending');
  assert.equal(steps['rule-26-disclosures'].dueDate, null);
});

test('the whole cascade, measured from each completion', () => {
  let p = {};
  p = completeStep(cmo, p, 'certificate-interested-parties', '2026-08-27');
  p = completeStep(cmo, p, 'meet-and-confer', '2026-09-21');

  const steps = byKey(resolveSequence('M1', cmo, p, { startedOn: '2026-08-01' }));
  assert.equal(steps['rule-26-disclosures'].status, 'active');
  assert.equal(steps['rule-26-disclosures'].dueDate, '2026-11-21', '61 days after 2026-09-21');
  assert.equal(steps['joint-report'].status, 'pending');
});

test('a late completion moves everything after it', () => {
  // Meet and confer was due Sep 21 but actually happened Oct 5.
  let onTime = completeStep(cmo, {}, 'certificate-interested-parties', '2026-08-27');
  onTime = completeStep(cmo, onTime, 'meet-and-confer', '2026-09-21');

  let late = completeStep(cmo, {}, 'certificate-interested-parties', '2026-08-27');
  late = completeStep(cmo, late, 'meet-and-confer', '2026-10-05');

  const a = byKey(resolveSequence('M1', cmo, onTime, { startedOn: '2026-08-01' }));
  const b = byKey(resolveSequence('M1', cmo, late, { startedOn: '2026-08-01' }));

  assert.equal(a['rule-26-disclosures'].dueDate, '2026-11-21');
  assert.equal(b['rule-26-disclosures'].dueDate, '2026-12-05', 'scheduled from actual completion');
});

test('completed steps stay visible — the audit trail must not empty itself', () => {
  let p = completeStep(cmo, {}, 'certificate-interested-parties', '2026-08-27');
  p = completeStep(cmo, p, 'meet-and-confer', '2026-09-21');

  const steps = resolveSequence('M1', cmo, p, { startedOn: '2026-08-01' });
  assert.equal(steps.length, cmo.steps.length, 'no step disappears once done');
  assert.equal(steps.filter((s) => s.status === 'done').length, 2);
});

test('exactly one step is active at a time', () => {
  let p = completeStep(cmo, {}, 'certificate-interested-parties', '2026-08-27');
  const steps = resolveSequence('M1', cmo, p, { startedOn: '2026-08-01' });
  assert.equal(steps.filter((s) => s.status === 'active').length, 1);
});

test('un-completing rolls the schedule back', () => {
  let p = completeStep(cmo, {}, 'certificate-interested-parties', '2026-08-27');
  let steps = byKey(resolveSequence('M1', cmo, p, { startedOn: '2026-08-01' }));
  assert.equal(steps['meet-and-confer'].dueDate, '2026-09-21');

  p = uncompleteStep(cmo, p, 'certificate-interested-parties');
  steps = byKey(resolveSequence('M1', cmo, p, { startedOn: '2026-08-01' }));
  assert.equal(steps['certificate-interested-parties'].status, 'active');
  assert.equal(steps['meet-and-confer'].status, 'pending');
  assert.equal(steps['meet-and-confer'].dueDate, null, 'the scheduled date is withdrawn too');
});

test('a skipped step does not block the sequence', () => {
  let p = skipStep({}, 'certificate-interested-parties');
  p = { ...p, 'meet-and-confer': {} };
  const steps = byKey(resolveSequence('M1', cmo, p, { startedOn: '2026-08-27' }));
  assert.equal(steps['certificate-interested-parties'].status, 'skipped');
  assert.equal(steps['meet-and-confer'].status, 'active', 'the next step still schedules');
});

test('a manually set due date is respected over the computed one', () => {
  let p = completeStep(cmo, {}, 'certificate-interested-parties', '2026-08-27');
  p['meet-and-confer'] = { ...p['meet-and-confer'], dueDate: '2026-10-15' };
  const steps = byKey(resolveSequence('M1', cmo, p, { startedOn: '2026-08-01' }));
  assert.equal(steps['meet-and-confer'].dueDate, '2026-10-15', 'the human date wins');
});

test('reminders ladder back from the due date and start unsent', () => {
  const r = buildReminders('2026-12-01', [90, 60, 30, 15]);
  assert.deepEqual(
    r.map((x) => x.date),
    ['2026-09-02', '2026-10-02', '2026-11-01', '2026-11-16']
  );
  assert.ok(r.every((x) => x.sent === false), 'sent is the idempotency key');
  assert.deepEqual(buildReminders('', [30]), [], 'no date, no reminders');
});

test('weekend and holiday warnings ride along on scheduled steps', () => {
  // 2026-12-25 is a Friday. Completing 61 days earlier lands Rule 26 on it.
  let p = completeStep(cmo, {}, 'certificate-interested-parties', '2026-08-27');
  p = completeStep(cmo, p, 'meet-and-confer', '2026-10-25');
  const steps = byKey(resolveSequence('M1', cmo, p, { startedOn: '2026-08-01' }));
  assert.equal(steps['rule-26-disclosures'].dueDate, '2026-12-25');
  assert.equal(steps['rule-26-disclosures'].badDate, 'Christmas Day', 'flagged, not moved');
});

test('step ids are deterministic, so regeneration updates in place', () => {
  assert.equal(sequenceStepId('M1', 'cmo', 'joint-report'), 'seq:M1:cmo:joint-report');
  const a = resolveSequence('M1', cmo, {}, { startedOn: '2026-08-27' });
  const b = resolveSequence('M1', cmo, {}, { startedOn: '2026-08-27' });
  assert.deepEqual(a.map((s) => s.id), b.map((s) => s.id));
});

test('every sequence carries a citation or a confirm-with-attorney note', () => {
  for (const seq of SEQUENCES) {
    assert.ok(seq.note && seq.note.length > 10, `${seq.key} has a note`);
    assert.ok(/[Cc]onfirm/.test(seq.note), `${seq.key} tells the reader to confirm it`);
    assert.ok(seq.steps.length >= 2, `${seq.key} is actually a sequence`);
  }
});
