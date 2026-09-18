/**
 * Filtering a matter's Activity tab by what kind of thing each entry is.
 *
 * The global Feed has had a rail of kinds since early on. A matter's Activity
 * tab — the view people actually live in — had none, so finding "did anyone
 * call them back" meant scrolling past every email, note and task on the case.
 *
 * ── Only the kinds that are there ────────────────────────────────────────
 *
 * The enum allows eight kinds. Offering all eight on every case would mean a
 * row of filters that mostly return nothing, and a filter that returns nothing
 * reads as a fault rather than as an empty category. So the list is built from
 * what the case actually holds.
 *
 * `system` is deliberately absent from the labels: entries the app wrote about
 * itself are not a category anyone browses by. They still appear under All.
 */

export const KIND_LABELS = {
  note: 'Notes',
  call: 'Calls',
  text: 'Texts',
  email: 'Emails',
  task: 'Tasks',
  fax: 'Faxes',
  reminder: 'Reminders',
};

/**
 * The order they appear in. Matches how the firm talks about them — the three
 * ways a person gets in touch, then what was written down, then what is owed.
 */
const ORDER = ['note', 'call', 'text', 'email', 'task', 'fax', 'reminder'];

/**
 * Counts per kind, for the entries given.
 * @returns {{key: string, label: string, count: number}[]} `all` first, then
 *   only the kinds actually present, in ORDER.
 */
export function kindCounts(entries = []) {
  const list = Array.isArray(entries) ? entries : Object.values(entries || {});
  const counts = new Map();
  for (const e of list) {
    const k = e?.kind;
    if (!k) continue;
    counts.set(k, (counts.get(k) || 0) + 1);
  }

  const out = [{ key: 'all', label: 'All', count: list.length }];
  for (const key of ORDER) {
    const count = counts.get(key);
    if (!count) continue;
    out.push({ key, label: KIND_LABELS[key] || key, count });
  }
  return out;
}

/** `all` (or anything unrecognised) means no filtering — never an empty list. */
export function filterByKind(entries = [], kind = 'all') {
  const list = Array.isArray(entries) ? entries : Object.values(entries || {});
  if (!kind || kind === 'all' || !(kind in KIND_LABELS)) return list;
  return list.filter((e) => e?.kind === kind);
}
