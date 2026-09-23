import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyContact, displayName, naturalName, validateContact, searchContacts, searchHaystack, duplicateCandidates, pruneEntries, CONTACT_ROLES, rolesOf, freeTagsOf, hasRole, toggleRole, browseContacts, roleCounts, matchContactsByName, primaryPhone, primaryEmail, matterRefs, phoneByLabel, primaryAddress, formatAddress } from './contact.js';

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

/* ------------------------------------------------------------------ *
 * Roles
 * ------------------------------------------------------------------ */

test('roles come back in a fixed order, not the order they were stored', () => {
  const c = { tags: ['Expert', 'Client', 'Medical Provider'] };
  assert.deepEqual(rolesOf(c), ['Client', 'Medical Provider', 'Expert']);
});

test('a contact can hold several roles at once', () => {
  // The treating orthopaedist who later testifies is one person, not two
  // records -- which is the whole reason roles are a list.
  const c = { tags: ['Medical Provider', 'Expert'] };
  assert.ok(hasRole(c, 'Medical Provider'));
  assert.ok(hasRole(c, 'Expert'));
  assert.ok(!hasRole(c, 'Client'));
});

test('tags the app does not know are preserved, not swallowed', () => {
  const c = { tags: ['Client', 'spanish-speaking'] };
  assert.deepEqual(freeTagsOf(c), ['spanish-speaking']);
  const after = toggleRole(c, 'Witness', true);
  assert.deepEqual(after.tags, ['Client', 'Witness', 'spanish-speaking']);
});

test('toggling a role off leaves everything else alone', () => {
  const c = { tags: ['Client', 'Adjuster', 'vip'] };
  assert.deepEqual(toggleRole(c, 'Adjuster', false).tags, ['Client', 'vip']);
});

test('toggling a role on twice does not duplicate it', () => {
  let c = { tags: [] };
  c = toggleRole(c, 'Client', true);
  c = toggleRole(c, 'Client', true);
  assert.deepEqual(c.tags, ['Client']);
});

test('every role is a valid tag string', () => {
  for (const role of CONTACT_ROLES) {
    assert.equal(typeof role, 'string');
    assert.equal(role, role.trim());
  }
  assert.equal(new Set(CONTACT_ROLES).size, CONTACT_ROLES.length, 'no duplicates');
});

/* ------------------------------------------------------------------ *
 * Browsing
 * ------------------------------------------------------------------ */

const clinic = { id: 'p1', kind: 'company', companyName: 'Northside Orthopaedics', tags: ['Medical Provider'] };
const carrier = { id: 'p2', kind: 'company', companyName: 'Gulf Coast Mutual', tags: ['Insurance Company'] };
const marcus = { id: 'p3', firstName: 'Marcus', lastName: 'Rivera', tags: ['Client'] };
const gone = { id: 'p4', firstName: 'Old', lastName: 'Record', deletedAt: 'x', tags: ['Client'] };

test('an empty query lists everybody, surname-first', () => {
  const rows = browseContacts([carrier, marcus, clinic]);
  assert.deepEqual(rows.map((c) => c.id), ['p2', 'p1', 'p3']);
});

test('browsing matches inside a word, unlike the type-ahead', () => {
  /*
   * searchContacts matches word PREFIXES, which is right for a picker racing
   * your keystrokes and wrong for a directory. "ortho" finds Northside
   * Orthopaedics in both, because Orthopaedics is its own word -- the
   * difference shows on a fragment that starts mid-word, which is exactly how
   * people half-remember a clinic's name.
   */
  assert.deepEqual(browseContacts([clinic, carrier], { query: 'side' }).map((c) => c.id), ['p1']);
  assert.deepEqual(searchContacts([clinic, carrier], 'side').map((c) => c.id), []);

  assert.deepEqual(browseContacts([clinic, carrier], { query: 'ortho' }).map((c) => c.id), ['p1']);
});

test('every term must match, so two words narrow rather than widen', () => {
  assert.deepEqual(browseContacts([clinic, carrier], { query: 'north ortho' }).map((c) => c.id), ['p1']);
  assert.deepEqual(browseContacts([clinic, carrier], { query: 'north gulf' }), []);
});

test('the role filter and the query compose', () => {
  const all = [clinic, carrier, marcus];
  assert.deepEqual(browseContacts(all, { role: 'Medical Provider' }).map((c) => c.id), ['p1']);
  assert.deepEqual(browseContacts(all, { role: 'Client', query: 'rivera' }).map((c) => c.id), ['p3']);
  assert.deepEqual(browseContacts(all, { role: 'Client', query: 'ortho' }), []);
});

test('deleted contacts are never listed', () => {
  assert.deepEqual(browseContacts([gone, marcus]).map((c) => c.id), ['p3']);
  assert.deepEqual(browseContacts([gone], { role: 'Client' }), []);
});

test('role counts drive the filter chips, and count a contact once per role', () => {
  const both = { id: 'p5', firstName: 'Dr', lastName: 'Okonkwo', tags: ['Medical Provider', 'Expert'] };
  const untagged = { id: 'p6', firstName: 'No', lastName: 'Role' };
  const { counts, untagged: n } = roleCounts([clinic, carrier, marcus, both, untagged, gone]);
  assert.equal(counts['Medical Provider'], 2);
  assert.equal(counts['Insurance Company'], 1);
  assert.equal(counts.Client, 1);
  assert.equal(counts.Expert, 1);
  assert.equal(n, 1, 'the one with no role at all');
});

/* ------------------------------------------------------------------ *
 * Linking a case to a contact
 * ------------------------------------------------------------------ */

test('an identical name is offered as the obvious link', () => {
  const roster = [
    { id: 'c1', firstName: 'Abimbola Michelle', lastName: 'Adetan' },
    { id: 'c2', firstName: 'Bo', lastName: 'Alvarez' },
  ];
  assert.deepEqual(
    matchContactsByName(roster, 'Adetan, Abimbola Michelle').map((c) => c.id), ['c1']);
});

test('the match ignores case, accents and punctuation', () => {
  const roster = [{ id: 'c1', firstName: 'Jose', lastName: "O'Brien" }];
  assert.equal(matchContactsByName(roster, "o'brien, jose").length, 1);
  assert.equal(matchContactsByName(roster, 'OBRIEN, JOSE').length, 1);
});

test('two clients with the same name both come back, so a person chooses', () => {
  const roster = [
    { id: 'c1', firstName: 'Maria', lastName: 'Garcia' },
    { id: 'c2', firstName: 'Maria', lastName: 'Garcia' },
  ];
  assert.equal(matchContactsByName(roster, 'Garcia, Maria').length, 2);
});

test('a near miss is NOT offered as an exact link', () => {
  // "Adetan, Abimbola" is not "Adetan, Abimbola Michelle". Close is what the
  // search box is for; this is the one-click path and has to be certain.
  const roster = [{ id: 'c1', firstName: 'Abimbola', lastName: 'Adetan' }];
  assert.deepEqual(matchContactsByName(roster, 'Adetan, Abimbola Michelle'), []);
});

test('deleted contacts are never offered', () => {
  const roster = [{ id: 'c1', firstName: 'Bo', lastName: 'Alvarez', deletedAt: 'x' }];
  assert.deepEqual(matchContactsByName(roster, 'Alvarez, Bo'), []);
});

test('an empty name matches nothing rather than everything', () => {
  assert.deepEqual(matchContactsByName([{ id: 'c1', lastName: 'X' }], ''), []);
  assert.deepEqual(matchContactsByName([{ id: 'c1', lastName: 'X' }], null), []);
});

test('the primary phone and email skip blank entries', () => {
  const c = {
    phones: [{ label: 'Work', value: '   ' }, { label: 'Mobile', value: '713-555-0188' }],
    emails: [{ value: '' }, { value: 'bo@example.com' }],
  };
  assert.equal(primaryPhone(c), '713-555-0188');
  assert.equal(primaryEmail(c), 'bo@example.com');
  assert.equal(primaryPhone({}), '');
  assert.equal(primaryEmail(undefined), '');
});

/* ------------------------------------------------------------------ *
 * matterRefs — every case a contact appears on
 * ------------------------------------------------------------------ */

const jp = { id: 'c1', kind: 'person', firstName: 'John Paul', lastName: 'Bográn, Jr' };

test('the client link is found', () => {
  const refs = matterRefs(jp, { matters: { m1: { clientContactId: 'c1' } } });
  assert.deepEqual(refs, [{ matterId: 'm1', how: 'linked', where: ['Client'] }]);
});

test('an attorney on thirty cases is found on all of them', () => {
  /*
   * The tab used to count only the client link and said a provider or
   * defence firm "cannot be traced back here yet". Contact fields store
   * { id, name } now, so it can.
   */
  const sections = {};
  for (let i = 0; i < 30; i++) sections[`m${i}`] = { pleading: { fields: { defatty: { id: 'c1', name: 'x' } }, rows: [] } };
  const refs = matterRefs(jp, { sections });
  assert.equal(refs.length, 30);
  assert.ok(refs.every((r) => r.how === 'linked'));
});

test('a reference inside a repeating row counts too', () => {
  const sections = { m1: { meds: { fields: {}, rows: [{ id: 'r1', provider: { id: 'c1', name: 'x' } }] } } };
  assert.deepEqual(matterRefs(jp, { sections }), [{ matterId: 'm1', how: 'linked', where: ['meds'] }]);
});

test('⚠️ a name-only match is reported as a guess, not a link', () => {
  /*
   * Rows typed before contact fields stored an id carry a bare name. Two
   * contacts can share one, and this cannot tell which was meant --
   * presenting that as a link is how somebody concludes an attorney is on a
   * case they have never touched.
   */
  const sections = { m1: { pleading: { fields: { defatty: 'Bográn, Jr, John Paul' }, rows: [] } } };
  const refs = matterRefs(jp, { sections });
  assert.equal(refs.length, 1);
  assert.equal(refs[0].how, 'named');
});

test('a link beats a name match on the same case', () => {
  const sections = {
    m1: {
      pleading: { fields: { defatty: 'Bográn, Jr, John Paul' }, rows: [] },
      depositions: { fields: { deponent: { id: 'c1', name: 'x' } }, rows: [] },
    },
  };
  const refs = matterRefs(jp, { sections });
  assert.equal(refs.length, 1);
  assert.equal(refs[0].how, 'linked', 'certainty should win');
  assert.deepEqual(refs[0].where, ['depositions', 'pleading']);
});

test('a different contact is not swept up', () => {
  const sections = { m1: { pleading: { fields: { defatty: { id: 'c2', name: 'Someone Else' } }, rows: [] } } };
  assert.deepEqual(matterRefs(jp, { sections }), []);
});

test('no id, no answer — an unsaved contact matches nothing', () => {
  assert.deepEqual(matterRefs({ firstName: 'New' }, { matters: { m1: { clientContactId: 'c1' } } }), []);
  assert.deepEqual(matterRefs(null, {}), []);
  assert.deepEqual(matterRefs(jp), []);
});

test('the row id is never mistaken for a contact id', () => {
  // Every row carries `id`. Comparing it against a contact id would make
  // every row in the database look like a reference.
  const sections = { m1: { meds: { fields: {}, rows: [{ id: 'c1' }] } } };
  assert.deepEqual(matterRefs(jp, { sections }), []);
});

/* ------------------------------------------------------------------ *
 * Reaching a contact's details — for the contact card, and for documents
 * ------------------------------------------------------------------ */

test('⚠️ phoneByLabel never falls back to another number', () => {
  /*
   * THE MOST IMPORTANT ASSERTION IN THIS FILE.
   *
   * A provider with a work number and no fax must yield NOTHING. Returning
   * the work number puts a voice line on the "Via Facsimile:" line of a
   * medical records request — a letter that goes nowhere and looks perfect,
   * and that nobody chases until the provider is weeks late.
   */
  const noFax = { phones: [{ label: 'Work', value: '(713) 555-0100' }] };
  assert.equal(phoneByLabel(noFax, 'Fax'), '');
  assert.equal(phoneByLabel(noFax, 'Work'), '(713) 555-0100');
});

test('phoneByLabel picks the labelled number out of several', () => {
  const c = { phones: [
    { label: 'Work', value: '(713) 555-0100' },
    { label: 'Mobile', value: '(281) 555-0199' },
    { label: 'Fax', value: '(713) 555-0142' },
  ] };
  assert.equal(phoneByLabel(c, 'Fax'), '(713) 555-0142');
  assert.equal(phoneByLabel(c, 'Mobile'), '(281) 555-0199');
});

test('phoneByLabel matches a label however it was typed', () => {
  // Labels are typed as often as chosen from the list.
  const c = { phones: [{ label: ' fax ', value: '(713) 555-0142' }] };
  assert.equal(phoneByLabel(c, 'Fax'), '(713) 555-0142');
});

test('phoneByLabel copes with a contact that has no phones at all', () => {
  assert.equal(phoneByLabel({}, 'Fax'), '');
  assert.equal(phoneByLabel(null, 'Fax'), '');
  assert.equal(phoneByLabel({ phones: [{ label: 'Fax', value: '  ' }] }, 'Fax'), '');
});

test('primaryAddress returns the parts, using postal rather than zip', () => {
  // The column is `postal`; Filevine's token is `address1zip`. Reconciling
  // the two is the job, and doing it in one place is the point.
  const c = { addresses: [{ label: 'Work', line1: '7600 Beechnut St', city: 'Houston', state: 'TX', postal: '77074' }] };
  assert.deepEqual(primaryAddress(c), {
    line1: '7600 Beechnut St', line2: '', city: 'Houston', state: 'TX', postal: '77074', country: '',
  });
});

test('primaryAddress skips a row somebody opened and left blank', () => {
  const c = { addresses: [{ label: 'Home' }, { line1: '7600 Beechnut St' }] };
  assert.equal(primaryAddress(c).line1, '7600 Beechnut St');
});

test('formatAddress reads properly when parts are missing', () => {
  // ⚠️ The reader that never existed: ContactField asked for `.value`, which
  // is not a key any address has, so no card in the app has ever shown one.
  assert.equal(
    formatAddress({ line1: '7600 Beechnut St', city: 'Houston', state: 'TX', postal: '77074' }),
    '7600 Beechnut St, Houston, TX 77074',
  );
  assert.equal(formatAddress({ line1: '7600 Beechnut St' }), '7600 Beechnut St');
  assert.equal(formatAddress({ city: 'Houston', state: 'TX' }), 'Houston, TX');
  assert.equal(formatAddress({ state: 'TX', postal: '77074' }), 'TX 77074');
  assert.equal(formatAddress({}), '');
  assert.equal(formatAddress(), '');
});

test('formatAddress keeps a second line', () => {
  assert.equal(
    formatAddress({ line1: '7600 Beechnut St', line2: 'Suite 210', city: 'Houston', state: 'TX', postal: '77074' }),
    '7600 Beechnut St, Suite 210, Houston, TX 77074',
  );
});
