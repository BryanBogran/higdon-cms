/**
 * PHASES, and the task flows they trigger.
 *
 * A phase is where the work has got to — distinct from `status`, which is only
 * whether the file is open. Filevine carries both, and the Project Hub filters
 * on phase.
 *
 * The automation is the part worth having. From the Filevine walkthrough:
 * moving a matter from PNC to Treatment created "Request medical records" and
 * "Ensure all health insurance docs are uploaded" without anyone asking for
 * them. The narrator's framing is the design goal —
 *
 *     "someone is not having to remember to say, ooh, did I ask Sarah to go
 *      ahead and request those medical records?"
 *
 * Two rules that keep this from becoming noise:
 *
 *   1. IDEMPOTENT. Entering a phase twice does not create the tasks twice. The
 *      key `flow:{matterId}:{phase}:{taskKey}` is what guarantees it — the same
 *      mechanism the deadline chain uses.
 *   2. NOTHING IS DELETED ON LEAVING. Moving backwards, or skipping ahead, must
 *      not silently remove work someone may already have started. Tasks a phase
 *      created outlive the phase.
 *
 * Assignment is by ROLE rather than by person, so a flow keeps working when
 * staff change. Roles resolve against the matter at generation time.
 */

import { todayInFirmTz, addDays } from './dates.js';

export const PHASES = [
  { key: 'pnc', label: 'PNC', description: 'Potential new client — not yet signed.' },
  { key: 'intake', label: 'Intake', description: 'Signed. Gathering the facts.' },
  { key: 'treatment', label: 'Treatment', description: 'Client is treating. Records accruing.' },
  { key: 'demand', label: 'Demand', description: 'Treatment complete. Demand package out.' },
  { key: 'negotiation', label: 'Negotiation', description: 'Talking numbers with the carrier.' },
  { key: 'litigation', label: 'Litigation', description: 'Suit filed.' },
  { key: 'settlement', label: 'Settlement', description: 'Settled, not yet disbursed.' },
  { key: 'disbursement', label: 'Disbursement', description: 'Liens resolved, funds out.' },
  { key: 'closed', label: 'Closed', description: 'File closed.' },
];

export const PHASE_BY_KEY = Object.fromEntries(PHASES.map((p) => [p.key, p]));

export const ROLES = ['attorney', 'paralegal', 'case manager', 'accounting'];

/**
 * Tasks created on entering a phase.
 *
 * `dueInDays` is measured from the day the phase is entered. Leave it out for a
 * task with no deadline — better than inventing one, since a fake due date is
 * worse than none on a list people are meant to trust.
 */
export const PHASE_TASK_FLOWS = {
  intake: [
    { key: 'signed-fee-agreement', title: 'Confirm signed fee agreement on file', role: 'paralegal', dueInDays: 3 },
    { key: 'open-file-checklist', title: 'Complete new-file checklist', role: 'case manager', dueInDays: 5 },
    { key: 'letters-of-representation', title: 'Send letters of representation to carriers', role: 'paralegal', dueInDays: 7 },
  ],
  treatment: [
    { key: 'request-medical-records', title: 'Request medical records', role: 'paralegal', dueInDays: 14 },
    { key: 'health-insurance-docs', title: 'Ensure all health insurance docs are uploaded, including a photo of the card', role: 'case manager', dueInDays: 7 },
    { key: 'treatment-check-in', title: 'Check in with client on treatment progress', role: 'case manager', dueInDays: 30 },
  ],
  demand: [
    { key: 'compile-medical-bills', title: 'Compile medical bills and records', role: 'paralegal', dueInDays: 7 },
    { key: 'lost-wage-verification', title: 'Obtain lost wage verification', role: 'paralegal', dueInDays: 10 },
    { key: 'draft-demand', title: 'Draft demand package', role: 'attorney', dueInDays: 14 },
  ],
  litigation: [
    { key: 'calendar-answer-date', title: 'Calendar answer date once served', role: 'paralegal', dueInDays: 3 },
    { key: 'draft-written-discovery', title: 'Draft written discovery', role: 'attorney', dueInDays: 21 },
    { key: 'identify-fact-witnesses', title: 'Identify fact witnesses', role: 'paralegal', dueInDays: 30 },
  ],
  settlement: [
    { key: 'confirm-settlement-terms', title: 'Confirm settlement terms in writing', role: 'attorney', dueInDays: 3 },
    { key: 'identify-liens', title: 'Identify and request all lien balances', role: 'paralegal', dueInDays: 7 },
    { key: 'signed-release', title: 'Obtain signed release', role: 'paralegal', dueInDays: 14 },
  ],
  disbursement: [
    { key: 'negotiate-liens', title: 'Negotiate outstanding liens', role: 'paralegal', dueInDays: 14 },
    { key: 'prepare-disbursement', title: 'Prepare disbursement statement', role: 'accounting', dueInDays: 7 },
    { key: 'client-disbursement-meeting', title: 'Schedule disbursement meeting with client', role: 'case manager', dueInDays: 10 },
  ],
  closed: [
    { key: 'closing-letter', title: 'Send closing letter to client', role: 'paralegal', dueInDays: 7 },
    { key: 'archive-file', title: 'Archive file per retention policy', role: 'case manager', dueInDays: 30 },
  ],
};

/** Deterministic id — this is what makes re-entering a phase idempotent. */
export function phaseTaskId(matterId, phaseKey, taskKey) {
  return `flow:${matterId}:${phaseKey}:${taskKey}`;
}

/**
 * Resolve a role to a person using whatever the matter knows.
 *
 * Falls back to "Unassigned" rather than guessing. An unassigned task is
 * visible and fixable; a task assigned to the wrong person quietly isn't.
 */
export function resolveRole(role, matterValues = {}) {
  if (role === 'attorney' && matterValues.attorney) return matterValues.attorney;
  if (role === 'paralegal' && matterValues.paralegal) return matterValues.paralegal;
  if (role === 'case manager' && matterValues.caseManager) return matterValues.caseManager;
  return 'Unassigned';
}

/**
 * Tasks to create on entering `phaseKey`, skipping any that already exist.
 *
 * Returns only what is NEW, so the caller can insert without worrying about
 * duplicates. Existing tasks are left exactly as they are — including their
 * completion state and any reassignment.
 */
export function tasksForPhase(matterId, phaseKey, matterValues = {}, existingTasks = {}, today = todayInFirmTz()) {
  const flow = PHASE_TASK_FLOWS[phaseKey];
  if (!flow) return [];

  return flow
    .map((t) => {
      const id = phaseTaskId(matterId, phaseKey, t.key);
      if (existingTasks[id]) return null; // already created; never duplicated
      return {
        id,
        matterId,
        title: t.title,
        note: `Created automatically on entering the ${PHASE_BY_KEY[phaseKey]?.label || phaseKey} phase. Confirm with attorney.`,
        dueDate: t.dueInDays ? addDays(today, t.dueInDays) : '',
        autoDueDate: t.dueInDays ? addDays(today, t.dueInDays) : '',
        manualOverride: false,
        assignedTo: resolveRole(t.role, matterValues),
        role: t.role,
        completed: false,
        calendarSynced: false,
        source: 'flow',
        phaseKey,
      };
    })
    .filter(Boolean);
}

/** How many of a phase's tasks already exist — for showing what a move will do. */
export function phaseFlowPreview(matterId, phaseKey, existingTasks = {}) {
  const flow = PHASE_TASK_FLOWS[phaseKey] || [];
  const willCreate = flow.filter((t) => !existingTasks[phaseTaskId(matterId, phaseKey, t.key)]);
  return { total: flow.length, willCreate: willCreate.length, titles: willCreate.map((t) => t.title) };
}
