/**
 * Finding a case by typing a name.
 *
 * ── The bug this module exists for ────────────────────────────────────────
 *
 * Both case searches used to be a plain substring test:
 *
 *     (v.clientName || '').toLowerCase().includes(term)
 *
 * Every case name in this system came out of a Google Drive folder, and those
 * folders are named "Aguilar, Carlos 23-180". So the stored name is
 * "Aguilar, Carlos", and a substring test means:
 *
 *     "Aguilar, Carlos"   found
 *     "aguilar"           found
 *     "Aguilar Carlos"    NOTHING   -- the comma is not there
 *     "Carlos Aguilar"    NOTHING   -- wrong order
 *     "Aguilar,Carlos"    NOTHING   -- no space after the comma
 *
 * Only the exact punctuation worked. A receptionist typing a client's name the
 * way anyone says it out loud got "No matching cases", and the reasonable
 * conclusion is that the case was never imported. That is exactly what the
 * team reported: a list of cases "not in the new system" that were in it all
 * along.
 *
 * ── The rule now ─────────────────────────────────────────────────────────
 *
 * The query is split into terms and EVERY term must match, in any order. A
 * term matches the START of a word in the name, or appears anywhere in the
 * case number.
 *
 * Prefix on names, substring on the number, and the asymmetry is deliberate:
 *   - Prefix on names because people type the beginning of a name. Substring
 *     on 344 cases turns "an" into most of the list.
 *   - Substring on the number because "180" has to keep finding 23-180, and a
 *     three-digit fragment of a case number is not going to collide with a
 *     name.
 *
 * This is the same rule searchContacts() in lib/domain/contact.js already
 * used, which is why "riv mar" finds "Rivera, Marcus" on the Contacts page
 * while the same query found nothing on Project Hub. One of the two was
 * right; the case searches were not.
 */

/**
 * Normalise for comparison. Hyphens survive so a case number stays one token;
 * everything else punctuation-like becomes a space, which is what lets
 * "Aguilar,Carlos" split into two terms.
 *
 * Moved here from contact.js, which had it privately -- the duplication was
 * how the two searches drifted apart in the first place.
 */
export const foldSearch = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    // Strip accents, so "Ureña" is found by typing "urena".
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9@.\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** The query, as the list of terms that must all match. */
export function searchTerms(query) {
  return foldSearch(query).split(' ').filter(Boolean);
}

/**
 * Does this case match what was typed?
 *
 * @param {object} values  a matter's `values` — clientName and caseNumber
 * @param {string} query   whatever is in the search box
 * @returns {boolean}      true for an empty query, so callers can skip a branch
 */
export function matchesCaseSearch(values = {}, query = '') {
  const terms = searchTerms(query);
  if (!terms.length) return true;

  const nameWords = foldSearch(values.clientName).split(' ').filter(Boolean);
  const number = foldSearch(values.caseNumber);

  return terms.every(
    (term) => nameWords.some((word) => word.startsWith(term))
      || (number !== '' && number.includes(term)),
  );
}
