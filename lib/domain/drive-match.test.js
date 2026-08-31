import test from 'node:test';
import assert from 'node:assert/strict';

import { nameKey, caseNumberIn, proposeMatch, planSync, looseCaseNumberIn } from './drive-match.js';

const matter = (clientName, extra = {}) => ({
  values: { clientName, ...(extra.values || {}) },
  ...extra,
});

test('word order does not matter — the spreadsheet and Drive disagree on it', () => {
  assert.equal(nameKey('Rivera, Marcus'), nameKey('Marcus Rivera'));
  assert.equal(nameKey('Rivera, Marcus Lee'), nameKey('Marcus Lee Rivera'));
  assert.equal(nameKey('Nguyen, Thanh'), nameKey('Thanh Nguyen'));
});

test('punctuation and suffixes are not part of the key', () => {
  assert.equal(nameKey("O'Connor, Sean"), nameKey('OConnor Sean'));
  assert.equal(nameKey('Smith-Jones, Ana'), nameKey('Ana Smith Jones'));
  assert.equal(nameKey('Turner Jr., Alex'), nameKey('Alex Turner'));
  assert.equal(nameKey('  Extra   Spaces  '), 'extra spaces');
});

test('an empty or junk name produces an empty key, never a match', () => {
  assert.equal(nameKey(''), '');
  assert.equal(nameKey(null), '');
  assert.equal(nameKey('!!!'), '');
});

test('a case number in the folder name is found', () => {
  assert.equal(caseNumberIn('Rivera, Marcus 26-001'), '26-001');
  assert.equal(caseNumberIn('(26-044) Smith'), '26-044');
  assert.equal(caseNumberIn('Smith, John'), '');
  // A trailing case number must not pollute the name key.
  assert.equal(nameKey('Rivera, Marcus 26-001'), nameKey('Rivera, Marcus'));
});

test('a clean single match auto-links', () => {
  const matters = { m1: matter('Rivera, Marcus'), m2: matter('Nguyen, Thanh') };
  const r = proposeMatch({ id: 'f1', name: 'Marcus Rivera' }, matters);
  assert.equal(r.status, 'auto');
  assert.equal(r.matterId, 'm1');
});

test('TWO CLIENTS WITH THE SAME NAME NEVER AUTO-LINK', () => {
  // The case this file exists for. Filing one Smith's medical records on the
  // other Smith is a privilege breach; an unlinked folder is a dropdown.
  const matters = { m1: matter('Smith, John'), m2: matter('Smith, John') };
  const r = proposeMatch({ id: 'f1', name: 'Smith, John' }, matters);
  assert.equal(r.status, 'ambiguous');
  assert.equal(r.candidates.length, 2);
});

test('an exact match sitting next to a near-miss does not auto-link either', () => {
  // "Smith, John" exact, "Smith, John Robert" one token away. Confident and
  // wrong is the failure mode being designed out.
  const matters = { m1: matter('Smith, John'), m2: matter('Smith, John Robert') };
  const r = proposeMatch({ id: 'f1', name: 'Smith, John' }, matters);
  assert.equal(r.status, 'ambiguous');
  assert.deepEqual(r.candidates.map((c) => c.why).sort(), ['exact name', 'partial name']);
});

test('a partial name alone is a suggestion, never automatic', () => {
  // The matter carries a middle name and the folder does not. Probably the
  // same person; possibly not, and "possibly not" does a lot of work on a
  // folder of medical records.
  const matters = { m1: matter('Rivera, Marcus Lee') };
  const r = proposeMatch({ id: 'f1', name: 'Rivera, Marcus' }, matters);
  assert.equal(r.status, 'ambiguous', 'a missing middle name might be a different person');
  assert.equal(r.candidates[0].matterId, 'm1');
  assert.equal(r.candidates[0].why, 'partial name');
});

test('a case number beats a name collision', () => {
  const matters = {
    m1: matter('Smith, John', { values: { caseNumber: '26-001' } }),
    m2: matter('Smith, John', { values: { caseNumber: '26-002' } }),
  };
  const r = proposeMatch({ id: 'f1', name: 'Smith, John 26-002' }, matters);
  assert.equal(r.status, 'auto');
  assert.equal(r.matterId, 'm2');
  assert.match(r.reason, /26-002/);
});

test('an already-linked folder is reported as linked, and never rematched', () => {
  const matters = { m1: matter('Smith, John', { driveFolderId: 'f1' }) };
  const r = proposeMatch({ id: 'f1', name: 'Completely Different Name' }, matters);
  assert.equal(r.status, 'linked');
  assert.equal(r.matterId, 'm1');
});

test('renaming a client cannot silently re-point an existing link', () => {
  // The confirm-once property. m1 is bound to f1 by id; a NEW folder that now
  // matches m1's name must not steal it.
  const matters = { m1: matter('Smith, John', { driveFolderId: 'f1' }) };
  const r = proposeMatch({ id: 'f2', name: 'Smith, John' }, matters);
  assert.equal(r.status, 'unmatched', 'm1 already has a folder; one case, one folder');
});

test('a matter that already has a folder is not offered to another one', () => {
  const matters = {
    m1: matter('Smith, John', { driveFolderId: 'other' }),
    m2: matter('Nguyen, Thanh'),
  };
  const r = proposeMatch({ id: 'f9', name: 'Smith, John' }, matters);
  assert.equal(r.status, 'unmatched');
});

test('archived matters are never matched', () => {
  const matters = { m1: matter('Smith, John', { archivedAt: '2026-01-01' }) };
  assert.equal(proposeMatch({ id: 'f1', name: 'Smith, John' }, matters).status, 'unmatched');
});

test('a folder matching nothing is unmatched, not force-fitted', () => {
  const matters = { m1: matter('Rivera, Marcus') };
  const r = proposeMatch({ id: 'f1', name: 'Old Firm Admin Stuff' }, matters);
  assert.equal(r.status, 'unmatched');
});

test('planSync reports every bucket before anything is written', () => {
  const matters = {
    m1: matter('Rivera, Marcus'),
    m2: matter('Smith, John'),
    m3: matter('Smith, John'),
    m4: matter('Okafor, Chidi', { driveFolderId: 'f4' }),
  };
  const plan = planSync(
    [
      { id: 'f1', name: 'Marcus Rivera' },
      { id: 'f2', name: 'Smith, John' },
      { id: 'f3', name: 'Random Folder' },
      { id: 'f4', name: 'Okafor, Chidi' },
    ],
    matters
  );
  assert.equal(plan.auto.length, 1);
  assert.equal(plan.ambiguous.length, 1);
  assert.equal(plan.unmatched.length, 1);
  assert.equal(plan.linked.length, 1);
});

test('no matters at all means nothing links, and nothing throws', () => {
  assert.equal(proposeMatch({ id: 'f1', name: 'Anyone' }, {}).status, 'unmatched');
  const plan = planSync([{ id: 'f1', name: 'X' }], {});
  assert.equal(plan.unmatched.length, 1);
});

/* ------------------------------------------------------------------ *
 * Creating a folder for a new matter
 * ------------------------------------------------------------------ */

import { caseFolderName, findExistingCaseFolder, CASE_SUBFOLDERS } from './drive-match.js';

test('a new folder carries the case number, so it can never be ambiguous', () => {
  assert.equal(caseFolderName({ clientName: 'Rivera, Marcus', caseNumber: '26-001' }),
    'Rivera, Marcus 26-001');
});

test('no case number yet means the name alone, not a trailing space', () => {
  assert.equal(caseFolderName({ clientName: 'Rivera, Marcus' }), 'Rivera, Marcus');
  assert.equal(caseFolderName({ clientName: 'Rivera, Marcus', caseNumber: '  ' }), 'Rivera, Marcus');
});

test('a nameless matter still produces something usable', () => {
  assert.equal(caseFolderName({ caseNumber: '26-009' }), '26-009');
  assert.equal(caseFolderName({}), 'Untitled case');
});

test('an existing hand-made folder is adopted rather than duplicated', () => {
  // Intake makes the folder, the matter is opened later. Creating a second
  // folder with the same name splits the case's documents across both.
  const folders = [{ id: 'f1', name: 'Rivera, Marcus' }, { id: 'f2', name: 'Okafor, Chidi' }];
  const found = findExistingCaseFolder(folders, { clientName: 'Rivera, Marcus', caseNumber: '26-001' });
  assert.equal(found.id, 'f1');
});

test('word order and punctuation do not stop the adoption', () => {
  const folders = [{ id: 'f1', name: 'Marcus Rivera' }];
  assert.equal(findExistingCaseFolder(folders, { clientName: 'Rivera, Marcus' }).id, 'f1');
});

test('a matching case number wins over the name', () => {
  const folders = [
    { id: 'f1', name: 'Smith, John' },
    { id: 'f2', name: 'Smith, John 26-002' },
  ];
  const found = findExistingCaseFolder(folders, { clientName: 'Smith, John', caseNumber: '26-002' });
  assert.equal(found.id, 'f2');
});

test('TWO CANDIDATES MEANS CREATE A NEW ONE, NOT PICK ONE', () => {
  // Same standard the matcher holds elsewhere. A numbered folder is the right
  // answer here: it disambiguates instead of guessing.
  const folders = [{ id: 'f1', name: 'Smith, John' }, { id: 'f2', name: 'Smith, John' }];
  assert.equal(findExistingCaseFolder(folders, { clientName: 'Smith, John' }), null);
});

test('a folder already belonging to another case is not adopted', () => {
  const folders = [{ id: 'f1', name: 'Rivera, Marcus' }];
  const taken = new Set(['f1']);
  assert.equal(findExistingCaseFolder(folders, { clientName: 'Rivera, Marcus' }, { linkedFolderIds: taken }), null);
});

test('nothing matching means nothing adopted', () => {
  assert.equal(findExistingCaseFolder([{ id: 'f1', name: 'Someone Else' }], { clientName: 'Rivera, Marcus' }), null);
  assert.equal(findExistingCaseFolder([], { clientName: 'Rivera, Marcus' }), null);
  assert.equal(findExistingCaseFolder([{ id: 'f1', name: 'X' }], {}), null, 'no client name, no match');
});

test('every case gets the same subfolder shape', () => {
  assert.ok(CASE_SUBFOLDERS.includes('Medical Records'));
  assert.ok(CASE_SUBFOLDERS.includes('Pleadings'));
  assert.equal(new Set(CASE_SUBFOLDERS).size, CASE_SUBFOLDERS.length, 'no duplicates');
});

/* ------------------------------------------------------------------ *
 * Real Drive folder names, from the firm's actual case folders
 * ------------------------------------------------------------------ */

test('the case number in a real folder name beats name matching', () => {
  const matters = {
    m1: { values: { clientName: 'Anderson, Lason', caseNumber: '26-033' } },
    m2: { values: { clientName: 'Anderson, Derrion', caseNumber: '21-239' } },
  };
  const r = proposeMatch({ id: 'f1', name: 'Anderson, Lason  26-033' }, matters);
  assert.equal(r.status, 'auto');
  assert.equal(r.matterId, 'm1');
  assert.match(r.reason, /case number/);
});

test('TWO FOLDERS WITH ONE CASE NUMBER BOTH GO TO REVIEW', () => {
  /*
   * The firm has five such pairs. proposeMatch is called once per folder
   * against an unchanging matters map, so without the pre-scan in planSync
   * BOTH return `auto` for the SAME matter and the second link silently
   * overwrites the first — one case holding the wrong folder, the other
   * none, and nothing on screen saying so.
   */
  const matters = { m1: { values: { clientName: 'Aguilar, Carlos', caseNumber: '23-180' } } };
  const folders = [
    { id: 'f1', name: 'Aguilar, Carlos 23-180' },
    { id: 'f2', name: 'Aguilar, Carlos 23-180 Progressive Declaratory Action' },
  ];

  assert.equal(proposeMatch(folders[0], matters).status, 'auto', 'alone, each looks certain');
  assert.equal(proposeMatch(folders[1], matters).status, 'auto');

  const plan = planSync(folders, matters);
  assert.equal(plan.auto.length, 0, 'neither may link on its own');
  assert.equal(plan.ambiguous.length, 2);
  assert.match(plan.ambiguous[0].candidates[0].why, /2 folders carry it/);
});

test('a unique case number still auto-links through planSync', () => {
  const matters = { m1: { values: { clientName: 'Alfred, Raveen', caseNumber: '21-135' } } };
  const plan = planSync([{ id: 'f1', name: 'Alfred, Raveen 21-135' }], matters);
  assert.equal(plan.auto.length, 1);
  assert.equal(plan.ambiguous.length, 0);
});

test('a fumbled hyphen is recovered as a suggestion, never as a link', () => {
  // Real names: "Ortiz-Arzu Pedro Serafin 23=105", "Ali Afshari 23 201".
  const matters = { m1: { values: { clientName: 'Ortiz-Arzu, Pedro Serafin', caseNumber: '23-105' } } };
  const r = proposeMatch({ id: 'f1', name: 'Ortiz-Arzu Pedro Serafin 23=105' }, matters);
  assert.equal(r.status, 'ambiguous', 'a human confirms a guess at a typo');
  assert.equal(r.candidates[0].matterId, 'm1');
  assert.match(r.candidates[0].why, /23-105/);
});

test('a space for a hyphen is recovered too', () => {
  const matters = { m1: { values: { clientName: 'Afshari, Ali', caseNumber: '23-201' } } };
  const r = proposeMatch({ id: 'f1', name: 'Ali Afshari 23 201' }, matters);
  assert.equal(r.status, 'ambiguous');
  assert.equal(r.candidates[0].matterId, 'm1');
});

test('a loose number that matches NO case suggests nothing', () => {
  // The guard that makes loose matching safe: it recognises, it never invents.
  const matters = { m1: { values: { clientName: 'Someone Else', caseNumber: '26-001' } } };
  const r = proposeMatch({ id: 'f1', name: 'Smith, John 12 345 Main Street' }, matters);
  assert.equal(r.status, 'unmatched');
});

test('looseCaseNumberIn refuses what is not a case number', () => {
  assert.equal(looseCaseNumberIn('Perdue Bobby 193'), '');
  assert.equal(looseCaseNumberIn('Hopkins J 15'), '');
  assert.equal(looseCaseNumberIn('Jannesari, Mohammad'), '');
  assert.equal(looseCaseNumberIn('Alfred, Jackson*NFL*100007504 MAF 004'), '');
  assert.equal(looseCaseNumberIn('Ortiz-Arzu Pedro Serafin 23=105'), '23-105');
  assert.equal(looseCaseNumberIn('Ali Afshari 23 201'), '23-201');
});

test('a folder whose matter already has a different folder is not stolen', () => {
  // One case, one folder. Without this a second "23-180" would detach the
  // documents already linked to that case.
  const matters = {
    m1: { values: { clientName: 'Aguilar, Carlos', caseNumber: '23-180' }, driveFolderId: 'other' },
  };
  const r = proposeMatch({ id: 'f1', name: 'Aguilar, Carlos 23-180' }, matters);
  assert.notEqual(r.status, 'auto');
});
