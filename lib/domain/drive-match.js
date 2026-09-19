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

import { splitProjectName } from '@/lib/domain/import';

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
  const all = Object.entries(matters);

  /*
   * 1. Already linked by id. Name matching never runs again for this folder.
   *
   * ⚠️ CHECKED AGAINST EVERY MATTER, ARCHIVED INCLUDED. Archiving a case does
   * not orphan its Drive folder -- the documents in it still belong to that
   * matter. This ran against live matters only, so archiving a case made its
   * folder look like nobody's and the sync offered to create a second case.
   */
  const bound = all.find(([, m]) => m?.driveFolderId === folder.id);
  if (bound) {
    return {
      status: 'linked',
      matterId: bound[0],
      archived: Boolean(matters[bound[0]]?.archivedAt),
    };
  }

  // Everything BELOW is about finding a NEW home for an unlinked folder, and
  // an archived case is not one. Only live matters are candidates.
  const entries = all.filter(([, m]) => !m?.archivedAt);

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
  // "Medicals", matching what the firm calls it and what uploads resolve to.
  // This said "Medical Records" while the Medicals tab uploaded to "Medicals",
  // so a new case got both -- one provisioned, one made on first upload.
  'Medicals',
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

/* ------------------------------------------------------------------ *
 * Creating matters FROM folders
 * ------------------------------------------------------------------ */

/**
 * Plan the reverse of a sync: a folder with no case becomes one.
 *
 * The firm's Drive already holds a folder per case, named
 * "Rivera, Marcus 26-033". That makes it a usable case list in its own
 * right, and creating from it is a legitimate way to stand the system up
 * — with one thing understood: a FOLDER NAME CARRIES NO SOL. Cases made
 * this way have a client, a number, and nothing else, and will sit under
 * Missing Key Dates until the Filevine reports are imported over the top.
 * That import matches on case number, so it lands on these rather than
 * duplicating them, and this is a first step rather than a substitute.
 *
 * ── Refusing is most of the job ───────────────────────────────────────
 *
 * Four reasons a folder is passed over, and none of them are failures:
 *
 *   no case number   TEMPLATES, ARCHIVED FILES, FILEVINE REPORTS — and
 *                    also the handful of real cases whose folder was
 *                    named without one. A case number is required, so a
 *                    folder without one cannot become a case here.
 *   already linked   the folder is on a matter already.
 *   number in use    a case with that number exists; the sync links them
 *                    rather than making a second.
 *   number shared    two folders carry it. Creating from the first and
 *                    not the second would be an arbitrary choice about
 *                    which one is the real case.
 *
 * `splitProjectName` comes from the spreadsheet importer on purpose. The
 * two paths must derive the same client name and the same case number
 * from the same string, or importing the reports afterwards would create
 * a second copy of everything instead of updating it.
 */
export function planCreateFromFolders(folders = [], matters = {}) {
  const create = [];
  const skipped = [];

  /*
   * ⚠️ EVERY MATTER, NOT JUST THE LIVE ONES.
   *
   * Both sets were built from live matters, so archiving a case removed its
   * folder from one and its number from the other -- and the sync then
   * offered to create a NEW case from that folder carrying the SAME case
   * number. Accepting it gives two cases sharing one number, one of them
   * pointed at a folder full of the other's documents.
   *
   * A folder linked to an archived case is still linked. A number held by an
   * archived case is still spoken for: 26-042 means "the 42nd case opened in
   * 2026", and handing it to a second case makes it ambiguous forever.
   *
   * (The database's unique index is partial on `deleted_at is null` and so
   * would permit the reuse. That was written for deleting a bad import,
   * where releasing the number is right. Archiving a closed case is a
   * different act sharing the same column, and the sync should not treat
   * the two as the same thing.)
   */
  const all = Object.entries(matters);
  const linkedFolderIds = new Set(all.map(([, m]) => m?.driveFolderId).filter(Boolean));
  const numbersInUse = new Set(
    all.map(([, m]) => String(m?.values?.caseNumber || '').trim()).filter(Boolean)
  );
  const archivedNumbers = new Set(
    all.filter(([, m]) => m?.archivedAt)
      .map(([, m]) => String(m?.values?.caseNumber || '').trim())
      .filter(Boolean)
  );

  // Folders sharing a number, counted before any decision is made.
  const counts = new Map();
  for (const f of folders) {
    const { caseNumber } = splitProjectName(f?.name);
    if (caseNumber) counts.set(caseNumber, (counts.get(caseNumber) || 0) + 1);
  }

  for (const folder of folders) {
    const name = String(folder?.name || '').trim();
    const { clientName, caseNumber } = splitProjectName(name);

    if (linkedFolderIds.has(folder?.id)) {
      skipped.push({ folder, reason: 'already linked to a case' });
    } else if (!caseNumber) {
      skipped.push({ folder, reason: 'no case number in the folder name' });
    } else if (counts.get(caseNumber) > 1) {
      /*
       * ⚠️ CHECKED BEFORE "already exists", and the order is the whole point.
       *
       * 26-063 is both: the case exists AND two folders carry the number.
       * This branch used to sit second, so such a folder was told "the sync
       * links it" -- and then the sync did not, because planSync deliberately
       * refuses to auto-link a number carried by more than one folder. It
       * cannot tell which folder is the case, and guessing would file one
       * client's medical records under another's matter.
       *
       * So the message promised something the sync would not do, and somebody
       * ran it and watched nothing happen. A skip reason is the only
       * explanation anyone gets; it has to describe what will actually
       * happen, including when the answer is "a person has to decide".
       */
      const exists = numbersInUse.has(caseNumber) ? ' The case exists;' : '';
      skipped.push({
        folder,
        reason: `${counts.get(caseNumber)} folders carry ${caseNumber}, so the sync cannot tell `
          + `which one belongs to it.${exists} Pick the right folder in the review queue.`,
      });
    } else if (numbersInUse.has(caseNumber)) {
      // Named distinctly: "already exists" on an archived case sends somebody
      // hunting through the case list for a matter deliberately not in it.
      skipped.push({
        folder,
        reason: archivedNumbers.has(caseNumber)
          ? `case ${caseNumber} exists but is archived — unarchive it rather than making a second`
          : `case ${caseNumber} already exists — the sync links it`,
      });
    } else {
      create.push({
        folder,
        caseNumber,
        // A folder named only "26-033" would otherwise make a case with no
        // client name, which matter.client_name forbids and which nobody
        // could find again by the only name they know.
        clientName: clientName || caseNumber,
      });
    }
  }

  return { create, skipped };
}

/**
 * What creating a case from one review-queue folder would do.
 *
 * Pure, because it decides which case number a client's file gets and that is
 * not a decision to leave sitting inline in a button label.
 *
 * The queue used to offer only two resolutions -- link this folder to a case
 * that already exists, or record that it is not a case folder. For a folder
 * like "Aguilar, Carlos 23-180" with no case 23-180 anywhere, both are false:
 * linking files a client's records against a stranger, and dismissing asserts
 * something untrue and loses the folder. This is the third resolution.
 *
 * `useNewNumber` is true when the folder's own number is already taken, which
 * happens because the firm files a related matter as
 * "23-180 Progressive Declaratory Action". One case can hold that number
 * (matter_case_number_uq) and one case can hold a folder (the unique index on
 * drive_folder_id), so the second folder must become its own case on a fresh
 * number, related back to the first. That is the only shape the schema can
 * represent -- not a workaround for it.
 *
 * @returns {{clientName, caseNumber, holderId, useNewNumber}}
 *   holderId  the case already holding `caseNumber`, if any — what to relate to
 */
export function planFolderCreate(folderName, matters = {}) {
  const { clientName, caseNumber } = splitProjectName(folderName);
  const name = clientName || String(folderName || '').trim();

  const holder = caseNumber
    ? Object.entries(matters).find(
      // Archived included: an archived case still holds its number.
      ([, m]) => String(m?.values?.caseNumber || '').trim() === caseNumber,
    )
    : undefined;

  return {
    clientName: name,
    caseNumber,
    holderId: holder ? holder[0] : '',
    // No number in the name, or the number is spoken for.
    useNewNumber: Boolean(holder) || !caseNumber,
  };
}
