import test from 'node:test';
import assert from 'node:assert/strict';
import { foldSearch, searchTerms, matchesCaseSearch } from '@/lib/domain/search';
import { buildCaseList } from '@/lib/domain/case-list';

/* ------------------------------------------------------------------ *
 * The reported bug, as a table
 * ------------------------------------------------------------------ */

test('a client is found however their name is typed', () => {
  /*
   * THE ACTUAL COMPLAINT. Case names come from Drive folders named
   * "Aguilar, Carlos 23-180", so the stored name carries a comma. Under the
   * old substring test only the exact punctuation matched, and staff reported
   * cases as "not in the new system" that were in it the whole time.
   */
  const values = { clientName: 'Aguilar, Carlos', caseNumber: '23-180' };

  for (const typed of [
    'Aguilar, Carlos',   // exact -- worked before
    'aguilar',           // one surname -- worked before
    'carlos',            // one forename -- worked before
    'Aguilar Carlos',    // no comma -- FAILED before
    'Carlos Aguilar',    // spoken order -- FAILED before
    'carlos aguilar',
    'Aguilar,Carlos',    // no space after the comma -- FAILED before
    '  carlos   aguilar  ',
    'agu car',           // partial words, either order
    'car agu',
    '23-180',            // the case number
    '180',               // part of the case number
    'aguilar 23-180',    // name and number together
  ]) {
    assert.equal(matchesCaseSearch(values, typed), true, `should find: "${typed}"`);
  }
});

test('it still refuses cases that do not match', () => {
  const values = { clientName: 'Aguilar, Carlos', caseNumber: '23-180' };
  for (const typed of ['Aguilera', 'Carlos Aguilera', 'Smithers', '24-180', 'zzz']) {
    assert.equal(matchesCaseSearch(values, typed), false, `should NOT find: "${typed}"`);
  }
});

test('every term must match, not just one', () => {
  // "Carlos Smithers" must not surface Aguilar just because Carlos matched --
  // that is how a paralegal opens the wrong client's file.
  const values = { clientName: 'Aguilar, Carlos', caseNumber: '23-180' };
  assert.equal(matchesCaseSearch(values, 'Carlos Smithers'), false);
  assert.equal(matchesCaseSearch(values, 'Aguilar 99-999'), false);
});

test('names match by word start, not substring', () => {
  /*
   * Deliberate narrowing. Substring matching on 344 cases turns "an" into most
   * of the list, which is the same reasoning searchContacts already used.
   */
  const values = { clientName: 'Aguilar, Carlos', caseNumber: '23-180' };
  assert.equal(matchesCaseSearch(values, 'agu'), true);
  assert.equal(matchesCaseSearch(values, 'guilar'), false, 'mid-word is not a match');
});

test('the case number matches anywhere, unlike a name', () => {
  // "180" has to keep finding 23-180 -- it did before, and a numeric fragment
  // is not going to collide with a name.
  const values = { clientName: 'Aguilar, Carlos', caseNumber: '23-180' };
  assert.equal(matchesCaseSearch(values, '180'), true);
  assert.equal(matchesCaseSearch(values, '3-18'), true);
});

test('accents and apostrophes do not hide a client', () => {
  assert.equal(matchesCaseSearch({ clientName: 'Ureña, José', caseNumber: '25-010' }, 'urena jose'), true);
  assert.equal(matchesCaseSearch({ clientName: "O'Brien, Sean", caseNumber: '25-011' }, 'obrien'), true);
  assert.equal(matchesCaseSearch({ clientName: "O'Brien, Sean", caseNumber: '25-011' }, "o'brien sean"), true);
});

test('an empty query matches everything, so callers need no special case', () => {
  const values = { clientName: 'Aguilar, Carlos', caseNumber: '23-180' };
  for (const q of ['', '   ', null, undefined, ',,,']) {
    assert.equal(matchesCaseSearch(values, q), true, `empty-ish: ${JSON.stringify(q)}`);
  }
});

test('a case with no name or number is not matched by a real query', () => {
  assert.equal(matchesCaseSearch({}, 'aguilar'), false);
  assert.equal(matchesCaseSearch({ clientName: '', caseNumber: '' }, 'aguilar'), false);
  assert.equal(matchesCaseSearch(undefined, 'aguilar'), false);
});

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

test('fold keeps hyphens so a case number stays one token', () => {
  assert.equal(foldSearch('Aguilar, Carlos 23-180'), 'aguilar carlos 23-180');
  assert.equal(foldSearch('  MULTIPLE   SPACES  '), 'multiple spaces');
});

test('searchTerms splits on punctuation as well as spaces', () => {
  assert.deepEqual(searchTerms('Aguilar,Carlos'), ['aguilar', 'carlos']);
  assert.deepEqual(searchTerms('  '), []);
});

/* ------------------------------------------------------------------ *
 * Project Hub uses the same rule
 * ------------------------------------------------------------------ */

test('the Project Hub list finds a client by spoken name order too', () => {
  // Both search surfaces had the same substring bug; fixing one is not enough.
  const matters = {
    m1: { values: { clientName: 'Aguilar, Carlos', caseNumber: '23-180', status: 'Open' } },
    m2: { values: { clientName: 'Smithers Jr., Timothy', caseNumber: '26-063', status: 'Open' } },
  };
  assert.deepEqual(buildCaseList(matters, { q: 'Carlos Aguilar' }).map((r) => r.id), ['m1']);
  assert.deepEqual(buildCaseList(matters, { q: 'timothy smithers' }).map((r) => r.id), ['m2']);
  assert.deepEqual(buildCaseList(matters, { q: '26-063' }).map((r) => r.id), ['m2']);
  assert.equal(buildCaseList(matters, { q: 'nobody' }).length, 0);
  assert.equal(buildCaseList(matters, { q: '' }).length, 2);
});
