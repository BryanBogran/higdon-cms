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

/* ------------------------------------------------------------------ *
 * Desks
 * ------------------------------------------------------------------ */

/**
 * Shared desks a task can be handed to, as well as a person.
 *
 * ⚠️ THESE WERE DELIBERATELY REMOVED, AND ARE DELIBERATELY BACK. The
 * cleanup above stripped every role account out of the dropdown, because
 * it had filled with `accounting · records · staff · scheduling ·
 * receptionist · test` sitting unlabelled beside the real people.
 *
 * But the complaint that drove that was TWELVE SPELLINGS OF TWO PEOPLE,
 * not the existence of desks. Monica asked for these three back on
 * 2026-09-21, and she is right: "send it to Records" is a real
 * instruction at a law firm, and a task that has to be parked on whoever
 * happens to staff the records desk today is a task that goes missing
 * when that person is out.
 *
 * So the three she named come back — BY NAME, capitalised, in their own
 * group in the dropdown — and `staff` and `test` stay gone. That is the
 * difference between a roster and a pile of strings.
 *
 * Accounting joined them on 2026-09-24, asked for by name: settlement
 * disbursements and cost reimbursements are handed to that desk, not to
 * whoever is doing the books this week. Added to the list, not re-admitted
 * through the role-account flag -- the reason below still holds.
 *
 * ⚠️ NOT DRIVEN BY `is_role_account`. Reading the flag would re-admit
 * every shared login, including `test`, and would print the profile
 * spellings, which are lowercase. An explicit list is three lines to
 * extend and cannot silently grow.
 */
export const DESKS = ['Records', 'Scheduling', 'Receptionist', 'Accounting'];

/**
 * The shared fold-and-dedupe behind both pickers.
 *
 * Returns `{ label, desk }` per entry. Desks are added AFTER people and
 * NOT authoritatively, so a real profile that happens to fold onto a desk
 * name keeps its own entry rather than being relabelled as furniture.
 */
function buildRoster({ people, currentUser, current, desks = [] } = {}) {
  /** fold key -> { label, desk }. Profiles claim their key first. */
  const chosen = new Map();

  const add = (name, { authoritative = false, desk = false } = {}) => {
    if (isNobody(name)) return;
    const label = String(name).trim();
    const key = foldName(label);
    if (!key) return;
    // First writer wins, except that an authoritative name overrides a legacy
    // one that folded to the same key -- the profile spelling is the only one
    // somebody chose deliberately.
    if (!chosen.has(key) || authoritative) chosen.set(key, { label, desk });
  };

  for (const name of people || []) add(name, { authoritative: true });
  add(currentUser?.displayName, { authoritative: true });
  for (const desk of desks) add(desk, { desk: true });
  // Last, and NOT authoritative: if this task's name folds onto a real
  // profile or a desk, that spelling is what shows. This is what turns a
  // historical lowercase `records` assignment into the Records desk.
  add(current);

  return [...chosen.values()];
}

const byLabel = (a, b) => a.localeCompare(b);

/**
 * Who can be named as a PERSON — the attorney on a case, and anywhere else
 * `type: 'person'` appears.
 *
 * ⚠️ NO DESKS HERE, ON PURPOSE. "Receptionist" is not the attorney in
 * charge of a file, and `assigneeFor()` in chain.js copies the attorney
 * onto every deadline it generates — so a desk in this list would quietly
 * become the owner of a statute of limitations.
 *
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
  return buildRoster({ people, currentUser, current })
    .map((e) => e.label)
    .sort(byLabel);
}

/**
 * Who a TASK can be handed to: the people, then the desks.
 *
 * Grouped rather than merged into one alphabetical list. Interleaved,
 * "Receptionist" lands between "Records" and "Rose Hassanzai" and the
 * reader cannot tell which of the three is a human. The group heading is
 * the whole point — picking the wrong entry does not fail, it assigns work
 * to a name nobody is watching.
 *
 * @returns {{label: string, names: string[]}[]} Empty groups are dropped, so
 *   a firm with no profiles yet does not render an empty "People" heading.
 */
export function taskAssigneeGroups({ people, currentUser, current } = {}) {
  const all = buildRoster({ people, currentUser, current, desks: DESKS });
  const named = (desk) => all.filter((e) => e.desk === desk).map((e) => e.label).sort(byLabel);

  return [
    { label: 'People', names: named(false) },
    { label: 'Desks', names: named(true) },
  ].filter((g) => g.names.length);
}

/** Flattened — for "is this value already offered?" checks in the UI. */
export function flattenGroups(groups = []) {
  return (groups || []).flatMap((g) => g.names || []);
}

/**
 * The assignable roster from profile rows.
 *
 * Shared mailboxes (`accounting`, `records`, `scheduling`) and people who have
 * left are excluded. They are legitimate logins — they simply are not someone
 * you hand a statute of limitations to. The three desks the firm actually
 * hands work to are offered separately; see DESKS above.
 */
export function assignablePeople(profiles = []) {
  return (profiles || [])
    .filter((p) => p && p.is_active !== false && p.is_role_account !== true)
    .map((p) => String(p.display_name || '').trim())
    .filter(Boolean);
}
