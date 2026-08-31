/**
 * Case numbers — YY-NNN, e.g. 26-033.
 *
 * The number is not decoration. 26-042 *means* "the 42nd case opened in 2026",
 * it is how staff refer to a file out loud, and it is half of every Drive
 * folder name. So it has one shape and the database enforces it:
 *
 *   matter.case_number_format  check (case_number ~ '^\d{2}-\d{3}$')
 *   matter_case_number_uq      unique, among matters not deleted
 *
 * Those two constraints are the real authority. Everything here exists so a
 * person is told what is wrong *while typing* rather than by a Postgres error
 * after they press Create.
 *
 * ── Why entering one by hand is allowed at all ────────────────────────────
 *
 * `allocate_case_number()` hands out the next one and is right for a new
 * intake. It is wrong for the case the firm is re-entering from a paper file,
 * which already has a number everyone has been using for a year. Forcing a
 * fresh number on that case renames it, and the number in the client's emails,
 * the medical authorisations and the carrier's correspondence stops matching.
 *
 * Pure: no store, no React, so the rules are testable on their own.
 */

export const CASE_NUMBER_RE = /^\d{2}-\d{3}$/;

/**
 * As-you-type formatting: digits only, hyphen inserted after the second.
 *
 * Typing "26033" gives "26-033" without anybody reaching for the hyphen, and
 * pasting "26-033" is idempotent. The alternative -- a plain text box policed
 * on submit -- produces "26 033" and "26–033" (en dash, from Word) and rejects
 * both at the end, which is the least helpful moment to say so.
 */
export function formatCaseNumberInput(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '').slice(0, 5);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

/** Two-digit year in the firm's timezone. `todayInFirmTz()` gives the date. */
export function yearPrefix(isoDate) {
  return String(isoDate || '').slice(2, 4);
}

/** Every case number in use, as strings. Deleted matters do not hold one. */
export function usedCaseNumbers(matters = {}) {
  const used = new Set();
  for (const m of Object.values(matters || {})) {
    if (m?.archivedAt || m?.deletedAt) continue;
    const n = String(m?.values?.caseNumber || '').trim();
    if (n) used.add(n);
  }
  return used;
}

/**
 * The next free number for a year — what the counter would hand out.
 *
 * Derived from the matters already loaded, so it is a *suggestion* shown next
 * to the input. The authoritative allocation is `allocate_case_number()` in
 * Postgres, which is atomic; this cannot be, and must not pretend to be.
 */
export function nextCaseNumber(matters = {}, yy) {
  let highest = 0;
  for (const n of usedCaseNumbers(matters)) {
    if (!CASE_NUMBER_RE.test(n)) continue;
    if (n.slice(0, 2) !== yy) continue;
    highest = Math.max(highest, Number(n.slice(3)));
  }
  if (highest >= 999) return null; // 999 cases in one year. Say so, don't wrap.
  return `${yy}-${String(highest + 1).padStart(3, '0')}`;
}

/**
 * @returns {{ error?: string, warning?: string }} — `error` blocks the save,
 *   `warning` does not. A number from an earlier year is a warning and not an
 *   error on purpose: back-entering last year's case is exactly the reason
 *   this field exists.
 */
export function validateCaseNumber(value, { matters = {}, currentYear } = {}) {
  const n = String(value || '').trim();
  if (!n) return { error: 'Enter a case number, or let it be assigned automatically.' };
  if (!CASE_NUMBER_RE.test(n)) {
    return { error: 'A case number is two digits, a hyphen, then three — 26-033.' };
  }
  if (usedCaseNumbers(matters).has(n)) {
    return { error: `${n} is already used by another case.` };
  }
  if (currentYear && n.slice(0, 2) !== currentYear) {
    return { warning: `${n} is not a ${currentYear} number. Fine for an older case — check it is deliberate.` };
  }
  return {};
}
