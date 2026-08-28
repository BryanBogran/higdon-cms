import test from 'node:test';
import assert from 'node:assert/strict';

import { nameKey, caseNumberIn, proposeMatch, planSync } from './drive-match.js';

const matter = (clientName, extra = {}) => ({
  values: { clientName, ...(extra.values || {}) },
  ...extra,
});

test('word order does not matter — the spreadsheet and Drive disagree on it', () => {
  assert.equal(nameKey('Rivera, Marcus'), nameKey('Marcus Rivera'));
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
  const matters = { m1: matter('Rivera, Marcus') };
  const r = proposeMatch({ id: 'f1', name: 'Rivera, Marcus' }, matters);
  assert.equal(r.status, 'ambiguous', 'a missing middle name might be a different person');
  assert.equal(r.candidates[0].matterId, 'm1');
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
