/**
 * Who a task can be assigned to.
 *
 * ── What went wrong ──────────────────────────────────────────────────────
 *
 * The list used to merge in every `assignedTo` any task had ever carried. The
 * intent was decent — somebody typed in before they had a login should stay
 * selectable — but a set of strings has no idea that six of them are one
 * person, so the firm's dropdown grew to:
 *
 *   jbogran · John Paul · John Paul Bográn Jr. · John Paul Bográn, Jr ·
 *   John Paul Bogran, Jr. · JP          … all the same attorney
 *   rose · Rose Hassanzai               … all the same paralegal
 *   accounting · records · staff · scheduling · receptionist · test
 *
 * Every spelling anyone ever typed, permanently, next to the real people.
 * Picking the wrong one does not fail — it assigns work to a name that
 * nobody is watching.
 *
 * ── What it does now ─────────────────────────────────────────────────────
 *
 * THE PROFILE TABLE IS THE ROSTER. It already carries `is_role_account` for
 * shared mailboxes and `is_active` for people who have left; both columns
 * existed from day one and nothing read them, which is the same write-only
 * column fault that hid linked contacts and Drive folders.
 *
 * Historical names are no longer merged in wholesale. Instead a task's OWN
 * assignee is offered on that task alone, via `current` — so an old task
 * still shows who it belongs to and can be saved without silently losing the
 * name, while nobody else's dropdown inherits it.
 *
 * Near-duplicates fold together: case, accents, and punctuation are ignored
 * when comparing, so "John Paul Bogran, Jr." and "John Paul Bográn Jr" are one
 * entry. When a fold collides, THE PROFILE'S SPELLING WINS — it is the only
 * spelling anyone chose on purpose.
 *
 * Pure: a function of its arguments, so the merge is testable without a
 * database or a React tree.
 */

export const UNASSIGNED = 'Unassigned';

/**
 * Compare people the way a person would: ignoring case, accents and
 * punctuation. "Bogran" and "Bográn" are one name; "J.P." and "JP" are one
 * name. It does NOT try to connect a handle to a full name — `jbogran` and
 * "John Paul Bogran" fold differently, and guessing that they are the same
 * human from the letters alone would eventually merge two real people.
 */
export function foldName(name) {
  return String(name || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')   // Bográn -> Bogran
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')        // commas, periods, spaces, hyphens
    .trim();
}

function isNobody(name) {
  const n = String(name || '').trim();
  // A blank and the literal "Unassigned" mean the same thing, and neither is a
  // person. Case-insensitive: "unassigned" typed by hand is the same word.
  return !n || n.toLowerCase() === UNASSIGNED.toLowerCase();
}

/**
 * @param {string[]} [opts.people]      Display names of assignable profiles —
 *   active, and not shared role accounts. The authoritative spelling.
 * @param {object}   [opts.currentUser] `{ displayName }`. You can always assign
 *   to yourself, including on a first run where you are the only profile.
 * @param {string}   [opts.current]     The assignee already on THIS task. Kept
 *   even when it is not a real profile, so an old task renders and saves
 *   without quietly dropping the name.
 * @returns {string[]} Sorted, de-duplicated, never containing "Unassigned" --
 *   that is an absence of an assignee, not a person, and the caller renders it
 *   as the empty option.
 */
export function assigneeOptions({ people, currentUser, current } = {}) {
  /** fold key -> the spelling to show. Profiles claim their key first. */
  const chosen = new Map();

  const add = (name, { authoritative = false } = {}) => {
    if (isNobody(name)) return;
    const label = String(name).trim();
    const key = foldName(label);
    if (!key) return;
    // First writer wins, except that an authoritative name overrides a legacy
    // one that folded to the same key -- the profile spelling is the only one
    // somebody chose deliberately.
    if (!chosen.has(key) || authoritative) chosen.set(key, label);
  };

  for (const name of people || []) add(name, { authoritative: true });
  add(currentUser?.displayName, { authoritative: true });
  // Last, and NOT authoritative: if this task's name folds onto a real
  // profile, the profile's spelling is what shows.
  add(current);

  return [...chosen.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * The assignable roster from profile rows.
 *
 * Shared mailboxes (`accounting`, `records`, `scheduling`) and people who have
 * left are excluded. They are legitimate logins — they simply are not someone
 * you hand a statute of limitations to.
 */
export function assignablePeople(profiles = []) {
  return (profiles || [])
    .filter((p) => p && p.is_active !== false && p.is_role_account !== true)
    .map((p) => String(p.display_name || '').trim())
    .filter(Boolean);
}
