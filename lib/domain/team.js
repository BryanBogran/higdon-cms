/**
 * Who a task can be assigned to.
 *
 * The roster used to be `Object.keys(team)` read straight off the profile
 * table, which is right in production and empty everywhere else -- so the
 * assignee dropdown on a fresh install, or in local-storage mode, offered
 * exactly one option ("Unassigned") and looked broken rather than unpopulated.
 *
 * Three sources, merged and de-duplicated:
 *
 *   1. `team`    — the profile table. One row per person who has signed in.
 *   2. the user  — you can always assign work to yourself, including on the
 *                  very first run when you are the only profile that exists.
 *   3. history   — any name already carried by a task. A person who left, or
 *                  who was typed in before they had a login, must stay
 *                  selectable or their open tasks cannot be reassigned back to
 *                  them, and reopening a task would silently drop the name.
 *
 * Pure: a function of its arguments, so the merge is testable without a
 * database or a React tree.
 */

export const UNASSIGNED = 'Unassigned';

/**
 * @param {object}   [opts.team]        `{ displayName: email }` from `profile`.
 * @param {object}   [opts.currentUser] `{ displayName }`.
 * @param {object[]} [opts.activity]    Entries; `assignedTo` is read off each.
 * @returns {string[]} Sorted, de-duplicated, never containing "Unassigned" --
 *   that is an absence of an assignee, not a person, and the caller renders it
 *   as the empty option.
 */
export function assigneeOptions({ team, currentUser, activity } = {}) {
  const names = new Set();

  const add = (n) => {
    const name = String(n || '').trim();
    // A blank and the literal "Unassigned" mean the same thing, and neither is
    // a person. Case-insensitive: "unassigned" typed by hand is the same word.
    if (!name || name.toLowerCase() === UNASSIGNED.toLowerCase()) return;
    names.add(name);
  };

  for (const name of Object.keys(team || {})) add(name);
  add(currentUser?.displayName);
  for (const entry of Object.values(activity || {})) add(entry?.assignedTo);

  return [...names].sort((a, b) => a.localeCompare(b));
}
