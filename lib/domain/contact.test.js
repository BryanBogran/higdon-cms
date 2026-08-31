import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyContact, displayName, naturalName, validateContact,
  searchContacts, searchHaystack, duplicateCandidates, pruneEntries,
} from './contact.js';

const person = (over = {}) => ({ ...emptyContact(), id: 'c1', firstName: 'Marcus', lastName: 'Rivera', ...over });

/* ------------------------------------------------------------------ *
 * Names
 * ------------------------------------------------------------------ */

test('a client reads surname first, the way the firm files them', () => {
  assert.equal(displayName(person()), 'Rivera, Marcus');
  assert.equal(displayName(person({ suffix: 'Jr.' })), 'Rivera, Marcus Jr.');
});

test('half a name is better than no name', () => {
  assert.equal(displayName(person({ firstName: '' })), 'Rivera');
  assert.equal(displayName(person({ lastName: '' })), 'Marcus');
});

test('a company is just its name', () => {
  const c = { kind: 'company', companyName: 'Metro Transit Authority' };
  assert.equal(displayName(c), 'Metro Transit Authority');
  assert.equal(naturalName(c), 'Metro Transit Authority');
});

test('a letter is addressed in natural order', () => {
  assert.equal(naturalName(person({ prefix: 'Mr.', middleName: 'Luis' })), 'Mr. Marcus Luis Rivera');
});

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

test('a contact has to be findable by some name', () => {
  assert.deepEqual(validateContact(person()), []);
  assert.equal(validateContact({ ...emptyContact() }).length, 1);
  assert.equal(validateContact({ kind: 'company', companyName: '' }).length, 1);
  assert.deepEqual(validateContact({ kind: 'company', companyName: 'Metro' }), []);
});

test('a malformed email is reported rather than stored', () => {
  const errors = validateContact(person({ emails: [{ label: 'Email', value: 'not-an-email' }] }));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /not an email/);
});

test('an empty email row is not an error — it is an unfilled row', () => {
  assert.deepEqual(validateContact(person({ emails: [{ label: 'Email', value: '' }] })), []);
});

/* ------------------------------------------------------------------ *
 * Search — the part a paralegal touches every day
 * ------------------------------------------------------------------ */

const roster = [
  person({ id: 'c1', firstName: 'Marcus', lastName: 'Rivera' }),
  person({ id: 'c2', firstName: 'Maria', lastName: 'Marquez' }),
  person({ id: 'c3', firstName: 'Ada', lastName: 'Okafor', emails: [{ value: 'ada@example.com' }] }),
  person({ id: 'c4', firstName: 'José', lastName: 'Ureña' }),
  person({ id: 'c5', firstName: 'Lena', lastName: 'Bergstrom', phones: [{ value: '(713) 555-0142' }] }),
  { ...emptyContact(), id: 'c6', kind: 'company', companyName: 'Metro Transit Authority' },
];

test('typing the start of a surname finds the person', () => {
  const hits = searchContacts(roster, 'riv');
  assert.equal(hits[0].id, 'c1');
});

test('two terms narrow rather than widen', () => {
  // "mar" alone matches both Marcus Rivera and Maria Marquez.
  assert.equal(searchContacts(roster, 'mar').length, 2);
  // Adding a second term must require BOTH to match.
  const narrowed = searchContacts(roster, 'mar riv');
  assert.equal(narrowed.length, 1);
  assert.equal(narrowed[0].id, 'c1');
});

test('order of terms does not matter', () => {
  assert.deepEqual(
    searchContacts(roster, 'riv mar').map((c) => c.id),
    searchContacts(roster, 'mar riv').map((c) => c.id),
  );
});

test('an accent does not have to be typed', () => {
  assert.equal(searchContacts(roster, 'urena')[0].id, 'c4');
  assert.equal(searchContacts(roster, 'jose')[0].id, 'c4');
});

test('a client can be found by the number they are calling from', () => {
  assert.equal(searchContacts(roster, '5550142')[0].id, 'c5');
  assert.equal(searchContacts(roster, '713')[0].id, 'c5');
});

test('a client can be found by email', () => {
  assert.equal(searchContacts(roster, 'ada@example.com')[0].id, 'c3');
});

test('companies are searchable too', () => {
  assert.equal(searchContacts(roster, 'metro')[0].id, 'c6');
});

test('a surname match outranks a first-name match', () => {
  // Typing "mar" while thinking of Marquez should not bury her under Marcus.
  const hits = searchContacts(roster, 'mar');
  assert.equal(hits[0].id, 'c2', 'Marquez matches on surname and should lead');
});

test('an empty query returns nothing rather than everything', () => {
  // A dropdown of 256 contacts on focus is not a search result.
  assert.deepEqual(searchContacts(roster, ''), []);
  assert.deepEqual(searchContacts(roster, '   '), []);
});

test('a term matching nothing returns nothing', () => {
  assert.deepEqual(searchContacts(roster, 'zzzz'), []);
});

test('deleted contacts do not come back in search', () => {
  const withDeleted = [...roster, person({ id: 'c9', lastName: 'Rivera', firstName: 'Gone', deletedAt: '2026-01-01' })];
  assert.ok(!searchContacts(withDeleted, 'riv').some((c) => c.id === 'c9'));
});

test('results are capped so the dropdown stays a dropdown', () => {
  const many = Array.from({ length: 50 }, (_, i) => person({ id: `x${i}`, lastName: 'Rivera', firstName: `A${i}` }));
  assert.equal(searchContacts(many, 'riv').length, 8);
  assert.equal(searchContacts(many, 'riv', { limit: 3 }).length, 3);
});

test('the haystack folds accents, apostrophes and punctuation away', () => {
  const hay = searchHaystack(person({ lastName: "O'Connor-Smith", firstName: 'José' }));
  assert.ok(hay.includes('oconnor-smith'));
  assert.ok(hay.includes('jose'));
});

/* ------------------------------------------------------------------ *
 * Duplicates — warn, never block
 * ------------------------------------------------------------------ */

test('the same name is surfaced as a possible duplicate', () => {
  const hits = duplicateCandidates(roster, person({ id: undefined }));
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, 'c1');
});

test('a shared email or phone counts even when the name differs', () => {
  const byEmail = duplicateCandidates(roster, {
    ...emptyContact(), firstName: 'A', lastName: 'Different', emails: [{ value: 'ADA@example.com' }],
  });
  assert.equal(byEmail[0].id, 'c3');

  const byPhone = duplicateCandidates(roster, {
    ...emptyContact(), firstName: 'B', lastName: 'Other', phones: [{ value: '713-555-0142' }],
  });
  assert.equal(byPhone[0].id, 'c5');
});

test('editing a contact does not flag it as its own duplicate', () => {
  assert.deepEqual(duplicateCandidates(roster, person({ id: 'c1' })), []);
});

test('a genuinely new client is not flagged', () => {
  assert.deepEqual(
    duplicateCandidates(roster, { ...emptyContact(), firstName: 'Thanh', lastName: 'Nguyen' }),
    [],
  );
});

/* ------------------------------------------------------------------ *
 * Repeating groups
 * ------------------------------------------------------------------ */

test('rows opened and never filled in are dropped on save', () => {
  const pruned = pruneEntries(person({
    phones: [{ label: 'Phone', value: '713-555-0100' }, { label: 'Mobile', value: '' }],
    emails: [{ label: 'Email', value: '' }],
    addresses: [{ label: 'Address', line1: '', city: '' }],
  }));
  assert.equal(pruned.phones.length, 1);
  assert.equal(pruned.emails.length, 0);
  assert.equal(pruned.addresses.length, 0);
});

test('an address with only a city is still an address', () => {
  const pruned = pruneEntries(person({ addresses: [{ label: 'Address', city: 'Houston' }] }));
  assert.equal(pruned.addresses.length, 1);
});
