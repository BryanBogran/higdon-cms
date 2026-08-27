/**
 * The deadline chain.
 *
 * Extracted from prototype/higdon-cms.jsx:81-110 with the date helpers swapped
 * for the rewritten module. Framework-free on purpose: from Phase 8 this runs
 * server-side inside the same transaction as the matter write, so it must not
 * import React.
 *
 * TWO RULES THAT ARE NOT NEGOTIABLE
 *
 * 1. Every rule carries its statutory citation and "Confirm with attorney" in
 *    `note`, verbatim. That text is the malpractice guardrail. A future UI
 *    cleanup must not tidy it away, and the note lives HERE rather than being
 *    copied onto task rows so it cannot drift between records.
 *
 * 2. AI never computes a deadline. A model may extract an anchor date and the
 *    rule text it found in a document; the arithmetic happens in this file,
 *    where it is readable and unit-testable. The RLF reference system states
 *    this principle and then violates it in its own document extractor — see
 *    docs/REFERENCE_FILEVINE_AND_RLF.md §3.1.
 */

import { addDays, nextMondayOnOrAfter, checkBadDate } from './dates.js';

/** A checklist item counts as a trigger only when it is done AND carries a date. */
function trigger(item) {
  return item?.done && item?.date ? item.date : null;
}

export const CHAIN_RULES = [
  {
    key: 'served',
    title: 'Answer Due',
    note: 'Tex. R. Civ. P. 99 — Monday next after 20 days from service. Confirm with attorney.',
    getDue: (v) => {
      const from = trigger(v.served);
      return from ? nextMondayOnOrAfter(addDays(from, 20)) : null;
    },
  },
  {
    key: 'plDiscoverySent',
    title: "Defendant's Discovery Response Due",
    note: 'Tex. R. Civ. P. 196/197 — 30 days. Confirm with attorney.',
    getDue: (v) => {
      const from = trigger(v.plDiscoverySent);
      return from ? addDays(from, 30) : null;
    },
  },
  {
    key: 'defDiscoveryReceived',
    title: "Plaintiff's Discovery Response Due",
    note: 'Tex. R. Civ. P. 196/197 — 30 days. Confirm with attorney.',
    getDue: (v) => {
      const from = trigger(v.defDiscoveryReceived);
      return from ? addDays(from, 30) : null;
    },
  },
  {
    key: 'sol',
    title: 'Statute of Limitations',
    note: 'From matter record.',
    getDue: (v) => v.sol || null,
  },
  {
    key: 'trialDate',
    title: 'Trial',
    note: 'From matter record.',
    getDue: (v) => v.trialDate || null,
  },
  {
    key: 'dco',
    title: 'Docket Control Order Deadline',
    note: 'From matter record.',
    getDue: (v) => v.dco || null,
  },
  {
    key: 'recordsOrdered',
    title: 'Follow Up on Medical Records',
    note: 'Internal — 30 days after ordered.',
    getDue: (v) => {
      const from = trigger(v.recordsOrdered);
      return from ? addDays(from, 30) : null;
    },
  },
  {
    key: 'plDepo',
    title: 'Send Deposition Transcript for Review',
    note: 'Internal — 14 days after deposition.',
    getDue: (v) => {
      const from = trigger(v.plDepo);
      return from ? addDays(from, 14) : null;
    },
  },
];

export const CHAIN_RULE_BY_KEY = Object.fromEntries(CHAIN_RULES.map((r) => [r.key, r]));

/** Deterministic composite id — the idempotency mechanism. Becomes UNIQUE(matter_id, rule_key). */
export function autoTaskId(matterId, ruleKey) {
  return `auto:${matterId}:${ruleKey}`;
}

/**
 * Regenerate every auto task from current matter data.
 *
 * Semantics preserved exactly from the prototype:
 *   - keyed by composite id, so regeneration updates in place, never duplicates
 *   - `completed`, `calendarSynced`, `assignedTo`, `manualOverride` survive
 *   - `dueDate` and `autoDueDate` are SEPARATE: autoDueDate always holds the
 *     computed value, dueDate diverges under manualOverride. That split is how
 *     "give me the auto date back" works.
 *   - an auto task whose trigger disappears is DELETED, unless it is completed
 *     or manually overridden
 *   - assignedTo defaults to the matter's attorney, else the literal "Unassigned"
 *
 * Added here: `badDate`, the weekend/holiday warning. It is advisory only — the
 * date is never silently moved. See docs/DECISIONS.md and dates.checkBadDate.
 */
export function generateChainTasks(matters, existingTasks = {}) {
  const tasks = { ...existingTasks };

  for (const [matterId, matter] of Object.entries(matters || {})) {
    const values = matter?.values || {};

    for (const rule of CHAIN_RULES) {
      const id = autoTaskId(matterId, rule.key);
      const due = rule.getDue(values);
      const existing = tasks[id];

      if (!due) {
        if (existing && !existing.completed && !existing.manualOverride) delete tasks[id];
        continue;
      }

      const manualOverride = existing?.manualOverride || false;
      const dueDate = manualOverride ? existing.dueDate : due;

      tasks[id] = {
        id,
        matterId,
        ruleKey: rule.key,
        title: rule.title,
        note: rule.note,
        dueDate,
        autoDueDate: due,
        manualOverride,
        assignedTo: existing?.assignedTo || values.attorney || 'Unassigned',
        completed: existing?.completed || false,
        calendarSynced: existing?.calendarSynced || false,
        source: 'auto',
        badDate: checkBadDate(dueDate),
      };
    }
  }

  return tasks;
}
