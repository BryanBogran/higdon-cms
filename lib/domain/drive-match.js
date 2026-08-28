/**
 * Matching a Google Drive folder to a matter.
 *
 * The firm's Drive has one folder per case, named with the CLIENT NAME ONLY —
 * no case number. So the only thing to match on is a human-typed name, on both
 * sides, entered years apart by different people.
 *
 * ── The rule this whole file exists to enforce ────────────────────────────
 *
 *   NEVER AUTO-LINK WHEN THERE IS ANY AMBIGUITY.
 *
 * A folder of medical records attached to the wrong client is a privilege
 * breach and a malpractice exposure. An unlinked folder is a five-second
 * dropdown. Those are not close in cost, so every uncertain case goes to a
 * human and the code does not get clever.
 *
 * Concretely: a folder auto-links only when exactly ONE matter has the same
 * normalised name AND no other matter is even a near-miss. Two clients called
 * Smith means neither links automatically, however confident a scorer might be.
 *
 * ── Confirm once, then match by id forever ────────────────────────────────
 *
 * Once a folder is linked, its Drive file id is stored on the matter and NAME
 * MATCHING IS NEVER USED AGAIN for it. Renaming the client, fixing a typo, or
 * a second Smith arriving later cannot silently re-point an existing link.
 * Names are for the first introduction only.
 */

/** Suffixes that are not part of the name for matching purposes. */
const SUFFIX = /\b(jr|sr|ii|iii|iv|md|esq)\b/g;

/** Trailing case-number-ish tokens some folders carry: "… 26-001", "(26-044)". */
const TRAILING_CASE_NO = /[\s(\[-]*\b(\d{2}-\d{3,4})\b[\s)\]]*$/;

/**
 * Reduce a name to a comparison key.
 *
 * "Rivera, Marcus" and "Marcus Rivera" are the same person written
 * two ways, and both appear in real data — the spreadsheet uses "Last, First"
 * and Drive folders are inconsistent. Sorting the tokens makes word order
 * irrelevant, which is the point: it is a KEY, not a display name.
 */
export function nameKey(value) {
  const base = String(value || '')
    .toLowerCase()
    .replace(TRAILING_CASE_NO, ' ')
    // Apostrophes are DELETED and hyphens become spaces, and the difference
    // matters. O'Connor must key the same as OConnor, so the apostrophe cannot
    // become a space or it splits into two tokens. Smith-Jones must key the
    // same as "Smith Jones", so the hyphen must.
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(SUFFIX, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!base) return '';
  return base.split(' ').filter(Boolean).sort().join(' ');
}

/** A case number embedded in a folder name, if the firm happened to add one. */
export function caseNumberIn(value) {
  const m = String(value || '').match(/\b(\d{2}-\d{3,4})\b/);
  return m ? m[1] : '';
}

/**
 * Given names as tokens, is one a prefix-subset of the other?
 *
 * "Rivera, Marcus" vs "Rivera, Marcus" — probably the same person,
 * possibly not. Returned as a SUGGESTION and never auto-linked, because
 * "possibly not" is doing a lot of work on a medical file.
 */
function isSubset(a, b) {
  const A = new Set(a.split(' '));
  const B = new Set(b.split(' '));
  if (A.size === 0 || B.size === 0) return false;
  const [small, large] = A.size <= B.size ? [A, B] : [B, A];
  if (small.size === large.size) return false; // identical size is equality, not subset
  for (const t of small) if (!large.has(t)) return false;
  return true;
}

/**
 * Propose a match for one Drive folder.
 *
 * Returns one of:
 *   { status: 'linked'      }  already bound by id — nothing to decide
 *   { status: 'auto',       matterId, reason }
 *   { status: 'ambiguous',  candidates[] }   several plausible; a human picks
 *   { status: 'unmatched'   }                nothing close
 *
 * `matters` is the app's `{ id: { values, driveFolderId } }` map.
 */
export function proposeMatch(folder, matters = {}) {
  const entries = Object.entries(matters).filter(([, m]) => !m?.archivedAt);

  // 1. Already linked by id. Name matching never runs again for this folder.
  const bound = entries.find(([, m]) => m?.driveFolderId === folder.id);
  if (bound) return { status: 'linked', matterId: bound[0] };

  // A matter that already has a DIFFERENT folder is not available: one case,
  // one folder. Without this, a second folder called "Smith" would attach
  // itself to a case that already has its documents somewhere else.
  const available = entries.filter(([, m]) => !m?.driveFolderId);

  const folderKey = nameKey(folder.name);
  if (!folderKey) return { status: 'unmatched', candidates: [] };

  // 2. A case number in the folder name beats any name match. It is the one
  //    identifier both systems agree on, when it is present at all.
  const caseNo = caseNumberIn(folder.name);
  if (caseNo) {
    const byNumber = available.filter(([, m]) => m?.values?.caseNumber === caseNo);
    if (byNumber.length === 1) {
      return { status: 'auto', matterId: byNumber[0][0], reason: `case number ${caseNo}` };
    }
  }

  const exact = [];
  const near = [];
  for (const [id, m] of available) {
    const key = nameKey(m?.values?.clientName);
    if (!key) continue;
    if (key === folderKey) exact.push({ matterId: id, name: m.values.clientName, why: 'exact name' });
    else if (isSubset(key, folderKey)) near.push({ matterId: id, name: m.values.clientName, why: 'partial name' });
  }

  // 3. Exactly one exact match, and nothing else in the neighbourhood.
  //
  //    The `near.length === 0` half is the important half. "Smith, John"
  //    matching exactly while "Smith, John Robert" sits next to it is precisely
  //    the situation where confidence is misplaced.
  if (exact.length === 1 && near.length === 0) {
    return { status: 'auto', matterId: exact[0].matterId, reason: 'exact name, no other candidate' };
  }

  const candidates = [...exact, ...near];
  if (candidates.length === 0) return { status: 'unmatched', candidates: [] };
  return { status: 'ambiguous', candidates };
}

/**
 * Match a whole listing, and report what a sync would do before it does it.
 *
 * Nothing is written from here. The caller shows the counts, the user agrees,
 * and only then does anything link — because "it silently attached 200 folders
 * to cases" is not something you want to discover afterwards.
 */
export function planSync(folders, matters = {}) {
  const plan = { linked: [], auto: [], ambiguous: [], unmatched: [] };
  for (const folder of folders) {
    const result = proposeMatch(folder, matters);
    plan[result.status].push({ folder, ...result });
  }
  return plan;
}
