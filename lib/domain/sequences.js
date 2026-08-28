/**
 * SEQUENTIAL DEADLINE CHAINS.
 *
 * This is a different mechanism from CHAIN_RULES in chain.js, and the
 * difference is the whole point.
 *
 *   chain.js       — DATA-triggered. A rule watches the matter record, and a
 *                    deadline exists as long as its trigger does. Mark Served
 *                    with a date and Answer Due appears; clear it and Answer
 *                    Due goes away.
 *
 *   this file      — SEQUENCE-triggered. Steps are a linked list. Completing
 *                    step N is what schedules step N+1, measured from the day
 *                    it was actually completed. Nothing downstream has a date
 *                    until the step before it is done.
 *
 * Filevine calls both of these "Deadline Chains", and only the second is what
 * their walkthrough demonstrates: complete Certificate of Interested Parties,
 * and Meet and Confer appears 25 days out; complete that, and Rule 26
 * Disclosures appears 61 days out, then the Joint Report, then the Scheduling
 * Conference. We had only the first mechanism.
 *
 * Two behaviours carried over deliberately:
 *
 *   - A completed step is marked done and STAYS VISIBLE. It is an audit trail,
 *     not a to-do list that empties itself.
 *   - Every deadline carries its own reminder schedule. Filevine's default is
 *     90/60/30/15 days out; each sequence can override.
 *
 * ⚠️ The sequences below are TEMPLATES, not legal advice. The offsets come from
 * a Filevine product walkthrough using a federal case-management order. They
 * must be confirmed against the actual scheduling order in each matter before
 * anyone relies on them — which is why every generated step carries the same
 * "Confirm with attorney" note the statutory rules do.
 */

import { addDays, checkBadDate, todayInFirmTz } from './dates.js';

/** Filevine's default reminder ladder, in days before the due date. */
export const DEFAULT_REMINDERS = [90, 60, 30, 15];

export const SEQUENCES = [
  {
    key: 'cmo',
    label: 'Case Management Order',
    note: 'Offsets follow the scheduling order. Confirm each against the order actually entered.',
    reminders: DEFAULT_REMINDERS,
    steps: [
      { key: 'certificate-interested-parties', title: 'Certificate of Interested Parties', offsetDays: 0 },
      { key: 'meet-and-confer', title: 'Meet and Confer', offsetDays: 25 },
      { key: 'rule-26-disclosures', title: 'Rule 26 Disclosures', offsetDays: 61 },
      { key: 'joint-report', title: 'Joint Report', offsetDays: 14 },
      { key: 'scheduling-conference', title: 'Scheduling Conference', offsetDays: 21 },
    ],
  },
  {
    key: 'written-discovery',
    label: 'Written Discovery',
    note: 'Tex. R. Civ. P. 196/197 — 30 days to respond. Confirm with attorney.',
    reminders: [30, 14, 7, 3],
    steps: [
      { key: 'discovery-served', title: 'Discovery Served', offsetDays: 0 },
      { key: 'objections-drafted', title: 'Draft Objections / Responses', offsetDays: 21, internal: true },
      { key: 'responses-due', title: 'Discovery Responses Due', offsetDays: 9 },
    ],
  },
];

export const SEQUENCE_BY_KEY = Object.fromEntries(SEQUENCES.map((s) => [s.key, s]));

/** Deterministic id, so regeneration updates in place rather than duplicating. */
export function sequenceStepId(matterId, sequenceKey, stepKey) {
  return `seq:${matterId}:${sequenceKey}:${stepKey}`;
}

/**
 * Reminder rows for one due date.
 *
 * `sent` is the idempotency key — a scheduled job flips it, so a reminder can
 * fire exactly once even if the job runs twice.
 */
export function buildReminders(dueDate, offsets = DEFAULT_REMINDERS) {
  if (!dueDate) return [];
  return offsets
    .map((daysBefore) => ({ daysBefore, date: addDays(dueDate, -daysBefore), sent: false }))
    .filter((r) => r.date);
}

/**
 * Compute the current state of one sequence on one matter.
 *
 * `progress` is `{ [stepKey]: { completedOn, dueDate, skipped } }` — whatever
 * has been recorded so far.
 *
 * Returns every step with a status:
 *   done     — completed, with the date it happened. Stays visible.
 *   active   — scheduled, because the step before it is done
 *   pending  — no date yet, because an earlier step is outstanding
 *   skipped  — explicitly marked not applicable
 */
export function resolveSequence(matterId, sequence, progress = {}, { startedOn } = {}) {
  const out = [];
  let anchor = startedOn || null;
  let blocked = false;

  for (const step of sequence.steps) {
    const rec = progress[step.key] || {};
    const id = sequenceStepId(matterId, sequence.key, step.key);

    if (rec.skipped) {
      out.push({ ...step, id, status: 'skipped', dueDate: null, reminders: [] });
      continue; // a skipped step does not move the anchor, nor block the next
    }

    if (rec.completedOn) {
      out.push({
        ...step,
        id,
        status: 'done',
        completedOn: rec.completedOn,
        dueDate: rec.dueDate || null,
        reminders: [],
      });
      anchor = rec.completedOn;
      continue;
    }

    // Not done. It is schedulable only if nothing before it is outstanding.
    if (blocked || !anchor) {
      out.push({ ...step, id, status: 'pending', dueDate: null, reminders: [] });
      blocked = true;
      continue;
    }

    const dueDate = rec.dueDate || addDays(anchor, step.offsetDays);
    out.push({
      ...step,
      id,
      status: 'active',
      dueDate,
      badDate: checkBadDate(dueDate),
      reminders: buildReminders(dueDate, sequence.reminders),
      note: sequence.note,
    });
    blocked = true; // only one step is active at a time
  }

  return out;
}

/**
 * Mark a step complete and return the updated progress, including the newly
 * scheduled next step. Completion date defaults to today in the firm's zone.
 */
export function completeStep(sequence, progress, stepKey, completedOn = todayInFirmTz()) {
  const idx = sequence.steps.findIndex((s) => s.key === stepKey);
  if (idx === -1) return progress;

  const next = { ...progress, [stepKey]: { ...(progress[stepKey] || {}), completedOn } };

  // Schedule the following step from the day this one actually completed --
  // not from when it was due. A step finished two weeks late moves everything
  // after it, which is the behaviour a real docket needs.
  const following = sequence.steps[idx + 1];
  if (following && !next[following.key]?.completedOn) {
    next[following.key] = {
      ...(next[following.key] || {}),
      dueDate: addDays(completedOn, following.offsetDays),
    };
  }
  return next;
}

/** Un-complete a step, and clear the scheduling it caused downstream. */
export function uncompleteStep(sequence, progress, stepKey) {
  const idx = sequence.steps.findIndex((s) => s.key === stepKey);
  if (idx === -1) return progress;

  const next = { ...progress };
  const rec = { ...(next[stepKey] || {}) };
  delete rec.completedOn;
  next[stepKey] = rec;

  const following = sequence.steps[idx + 1];
  if (following && next[following.key] && !next[following.key].completedOn) {
    const f = { ...next[following.key] };
    delete f.dueDate;
    next[following.key] = f;
  }
  return next;
}

export function skipStep(progress, stepKey, skipped = true) {
  return { ...progress, [stepKey]: { ...(progress[stepKey] || {}), skipped } };
}
