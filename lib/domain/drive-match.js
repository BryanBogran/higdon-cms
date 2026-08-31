/**
 * Matching a Google Drive folder to a matter.
 *
 * ── What the folders are actually named ──────────────────────────────────
 *
 * This file was written expecting CLIENT NAME ONLY. The firm's real Drive,
 * read in full on 2026-08-31, disagrees: 353 of its 359 case folders are named
 * "Rivera, Marcus 26-033" — the case number is right there. That is the one
 * identifier both systems agree on, and it is exact, so it is tried first and
 * the fuzzy name matching below is the fallback rather than the main event.
 *
 * The six that carry no usable number still need a name match, and so does any
 * folder made by hand in future, which is why all of it stays.
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
 * A case number that was TYPED WRONG. Second chance, never a first one.
 *
 * Real folder names from the firm's Drive: "Ortiz-Arzu Pedro Serafin 23=105"
 * and "Ali Afshari 23 201". Both are case numbers with the hyphen fumbled, and
 * `caseNumberIn` correctly refuses them — a loose pattern applied as the
 * primary rule would read the "12 345" in a street address as case 12-345 and
 * attach a stranger's medical records to it.
 *
 * So this exists, and `proposeMatch` uses it only after the strict form has
 * found nothing, only as a SUGGESTION a human confirms, and only when the
 * recovered number matches a real case. It recognises; it never invents.
 */
export function looseCaseNumberIn(value) {
  const m = String(value || '')
    .match(/(?<!\d)(\d{2})\s*[-\u2013\u2014=_ ]\s*(\d{3})(?!\d)/);
  return m ? `${m[1]}-${m[2]}` : '';
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

  let candidates = [...exact, ...near];

  /*
   * A case number with the hyphen typed wrong: "23=105", "23 201".
   *
   * Never auto-links — it is a guess at a typo, and this file's rule is that
   * guesses go to a person. But when it resolves to exactly one case it is
   * much STRONGER evidence than the partial-name match sitting beside it, so
   * it leads the candidate list and replaces the weaker reason for that same
   * matter. "case number 23-105, read from 23=105" tells a paralegal what to
   * check at a glance; "partial name" makes them go and look.
   */
  if (!caseNo) {
    const loose = looseCaseNumberIn(folder.name);
    if (loose) {
      const hits = available.filter(([, m]) => m?.values?.caseNumber === loose);
      if (hits.length === 1) {
        const [hitId, hitMatter] = hits[0];
        candidates = [
          {
            matterId: hitId,
            name: hitMatter?.values?.clientName || '',
            why: `case number ${loose}, read from "${folder.name}"`,
          },
          ...candidates.filter((c) => c.matterId !== hitId),
        ];
      }
    }
  }

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

  /*
   * ⚠️ TWO FOLDERS CARRYING THE SAME CASE NUMBER.
   *
   * The firm's Drive has five such pairs — 19-174, 22-006, 23-180, 24-081,
   * 26-063 — usually an original and a second action for the same client.
   *
   * `proposeMatch` cannot see this. It is called once per folder against an
   * unchanging `matters` map, so it would return `auto` pointing at the SAME
   * matter for BOTH, and the second link would silently overwrite the first.
   * One case would end up holding the wrong folder and the other none, with
   * nothing on screen to say so.
   *
   * Counted up front and every folder in a colliding set is sent to review
   * instead. A person spends thirty seconds; the alternative is a folder of
   * medical records filed under the wrong matter.
   */
  const numberCounts = new Map();
  for (const folder of folders) {
    const n = caseNumberIn(folder?.name);
    if (n) numberCounts.set(n, (numberCounts.get(n) || 0) + 1);
  }

  for (const folder of folders) {
    const result = proposeMatch(folder, matters);
    const n = caseNumberIn(folder?.name);

    if (result.status === 'auto' && n && numberCounts.get(n) > 1) {
      plan.ambiguous.push({
        folder,
        status: 'ambiguous',
        candidates: [{
          matterId: result.matterId,
          name: matters[result.matterId]?.values?.clientName || '',
          why: `case number ${n}, but ${numberCounts.get(n)} folders carry it — pick which one belongs here`,
        }],
      });
      continue;
    }

    plan[result.status].push({ folder, ...result });
  }
  return plan;
}

/* ------------------------------------------------------------------ *
 * Creating a folder for a new matter
 * ------------------------------------------------------------------ */

/**
 * Standard subfolders every new case gets.
 *
 * One shape for every case means staff never have to work out where a document
 * goes. Existing cases are left alone — imposing this on folders people already
 * organised would be rearranging their filing cabinet.
 */
export const CASE_SUBFOLDERS = [
  'Medical Records',
  'Pleadings',
  'Discovery',
  'Correspondence',
  'Expenses',
];

/**
 * What to call a new case folder: `Rivera, Marcus 26-001`.
 *
 * The case number is appended deliberately, even though existing folders are
 * name-only. It makes the folder unambiguous forever — `caseNumberIn` above
 * prefers a case number over any name match, so two clients called Smith stop
 * being a problem the moment both have numbered folders.
 *
 * Falls back to the name alone when there is no case number yet, rather than
 * producing a trailing space or an "undefined".
 */
export function caseFolderName(values = {}) {
  const name = String(values.clientName || '').trim();
  const number = String(values.caseNumber || '').trim();
  if (!name) return number || 'Untitled case';
  return number ? `${name} ${number}` : name;
}

/**
 * Is one of these folders already this case's, made by hand before the matter
 * existed?
 *
 * Intake creating the folder first and the matter being opened later is the
 * normal order of events, and creating a second folder with the same name is
 * how a case ends up with half its documents in each.
 *
 * Returns a folder only when the answer is unambiguous AND nothing else is
 * even close — the same standard `proposeMatch` applies, for the same reason.
 * When two folders could be it, the caller creates a new numbered one, which
 * disambiguates rather than guessing.
 *
 * Folders already linked to another matter are excluded: one folder, one case.
 */
export function findExistingCaseFolder(folders, values, { linkedFolderIds = new Set() } = {}) {
  const available = folders.filter((f) => !linkedFolderIds.has(f.id));
  const wantedKey = nameKey(values?.clientName);
  const caseNo = String(values?.caseNumber || '').trim();
  if (!wantedKey) return null;

  // A case number in the folder name settles it outright.
  if (caseNo) {
    const numbered = available.filter((f) => caseNumberIn(f.name) === caseNo);
    if (numbered.length === 1) return numbered[0];
    if (numbered.length > 1) return null;
  }

  const exact = available.filter((f) => nameKey(f.name) === wantedKey);
  // Exactly one, and no other folder carrying the same client name with a
  // different case number attached.
  if (exact.length === 1) return exact[0];
  return null;
}
