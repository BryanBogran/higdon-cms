import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TEMPLATES, TEMPLATE_BY_KEY, templatesFor, resolveTokens, contactFromCell, documentFilename,
} from './docgen.js';
import { scanTokens } from './docx.js';
import { SECTIONS } from '@/lib/sections/registry';
import { DRIVE_FOLDERS } from '@/lib/sections/registry';

const provider = (over = {}) => ({
  id: 'p1', kind: 'company', companyName: 'Memorial Hermann Southwest',
  phones: [{ label: 'Work', value: '(713) 555-0100' }, { label: 'Fax', value: '(713) 555-0142' }],
  addresses: [{ label: 'Work', line1: '7600 Beechnut St', city: 'Houston', state: 'TX', postal: '77074' }],
  ...over,
});

const clientContact = (over = {}) => ({
  id: 'c1', kind: 'person', firstName: 'Charles Wyatt', lastName: 'Hollister',
  ssn: '123-45-6789', dateOfBirth: '1998-03-04', phones: [], emails: [], addresses: [],
  ...over,
});

/** A case with everything filled in — the happy path. */
function fullCtx(over = {}) {
  return {
    matter: { values: { clientName: 'Hollister, Charles Wyatt', doa: '2023-01-12' }, clientContactId: 'c1' },
    sections: { intake: { fields: { referredfrom: { id: 'r1', name: 'Alvarez, Ericka' } }, rows: [] } },
    row: { id: 'row1', provider: { id: 'p1', name: 'Memorial Hermann Southwest' } },
    contacts: {
      c1: clientContact(),
      p1: provider(),
      r1: { id: 'r1', kind: 'person', firstName: 'Ericka', lastName: 'Alvarez', phones: [], emails: [], addresses: [] },
    },
    today: '2026-09-23',
    ...over,
  };
}

const KEY = 'med-records-request';

/* ------------------------------------------------------------------ *
 * The happy path
 * ------------------------------------------------------------------ */

test('a fully-filled case resolves every token', () => {
  const { values, missing } = resolveTokens(KEY, fullCtx());

  assert.deepEqual(missing, [], 'nothing should be missing');
  assert.equal(values.TODAY_LONG, 'September 23, 2026');
  assert.equal(values.fullname, 'Charles Wyatt Hollister');
  assert.equal(values.ssn, '123-45-6789');
  assert.equal(values.clientBirthdate, 'March 4, 1998');
  assert.equal(values.incidentDate, 'January 12, 2023');
  assert.equal(values['intake.referredfrom.lastFirst'], 'Alvarez, Ericka');
  assert.equal(values['meds.provider.name'], 'Memorial Hermann Southwest');
  assert.equal(values['meds.provider.fax1'], '(713) 555-0142');
  assert.equal(values['meds.provider.work1'], '(713) 555-0100');
  assert.equal(values['meds.provider.address1line1'], '7600 Beechnut St');
  assert.equal(values['meds.provider.address1city'], 'Houston');
  assert.equal(values['meds.provider.address1state'], 'TX');
  assert.equal(values['meds.provider.address1zip'], '77074');
});

test('the dates resolve the same in every timezone', () => {
  // The reason the suite runs three times. A date of injury off by one is a
  // statute of limitations off by one.
  const { values } = resolveTokens(KEY, fullCtx());
  assert.equal(values.incidentDate, 'January 12, 2023');
  assert.equal(values.clientBirthdate, 'March 4, 1998');
});

/* ------------------------------------------------------------------ *
 * ⚠️ The failure that would go unnoticed
 * ------------------------------------------------------------------ */

test('⚠️ a provider with no fax yields nothing, never the work number', () => {
  /*
   * THE REGRESSION TEST FOR THE WORST PLAUSIBLE BUG IN THIS FEATURE.
   *
   * A voice line printed under "Via Facsimile:" produces a letter that looks
   * perfect and reaches nobody. Nothing chases it; the records simply never
   * arrive, and weeks later somebody asks why.
   */
  const ctx = fullCtx();
  ctx.contacts.p1 = provider({ phones: [{ label: 'Work', value: '(713) 555-0100' }] });

  const { values, missing } = resolveTokens(KEY, ctx);
  assert.equal(values['meds.provider.fax1'], '');
  assert.notEqual(values['meds.provider.fax1'], '(713) 555-0100');

  const fax = missing.find((m) => m.token === 'meds.provider.fax1');
  assert.ok(fax, 'it must be reported');
  assert.equal(fax.required, true, 'and it must block the document');
});

/* ------------------------------------------------------------------ *
 * The two shapes real data comes in
 * ------------------------------------------------------------------ */

test('a provider typed as text gives its name and nothing else', () => {
  // Most existing rows are this shape: a bare string with no contact behind
  // it. The name still prints; the fax and address cannot be invented.
  const ctx = fullCtx({ row: { id: 'row1', provider: 'Northside Orthopaedics' } });
  const { values, missing } = resolveTokens(KEY, ctx);

  assert.equal(values['meds.provider.name'], 'Northside Orthopaedics');
  assert.equal(values['meds.provider.fax1'], '');
  assert.equal(values['meds.provider.address1city'], '');

  const reasons = new Set(missing.filter((m) => m.token.startsWith('meds.')).map((m) => m.reason));
  assert.deepEqual([...reasons], ['provider-not-linked']);
  assert.match(missing.find((m) => m.token === 'meds.provider.fax1').why, /Northside Orthopaedics/);
  assert.match(missing.find((m) => m.token === 'meds.provider.fax1').why, /link/i);
});

test('⚠️ a name is never matched to a contact behind the scenes', () => {
  /*
   * The contact IS in the directory under exactly that name, and it still
   * must not be used. `matchContactsByName`'s own comment settles it:
   * "Offered, never applied." Two providers called Memorial Hermann is not a
   * data-entry error, and a patient's records going to the wrong one is not a
   * recoverable mistake.
   */
  const ctx = fullCtx({ row: { id: 'row1', provider: 'Memorial Hermann Southwest' } });
  const { values } = resolveTokens(KEY, ctx);
  assert.equal(values['meds.provider.fax1'], '', 'must not be resolved by name');
});

test('no linked client contact means no SSN and no date of birth', () => {
  // The commonest reason a document will not generate on day one:
  // client_contact_id is nullable and was deliberately never backfilled.
  const ctx = fullCtx();
  ctx.matter.clientContactId = '';

  const { values, missing } = resolveTokens(KEY, ctx);
  assert.equal(values.ssn, '');
  assert.equal(values.clientBirthdate, '');
  for (const token of ['ssn', 'clientBirthdate']) {
    assert.equal(missing.find((m) => m.token === token).reason, 'no-client-contact');
  }
  assert.match(missing.find((m) => m.token === 'ssn').why, /no client contact linked/i);
});

test('the client name still comes through without a linked contact', () => {
  // It is the one thing the matter row itself carries.
  const ctx = fullCtx();
  ctx.matter.clientContactId = '';
  const { values, missing } = resolveTokens(KEY, ctx);

  assert.equal(values.fullname, 'Hollister, Charles Wyatt');
  assert.ok(!missing.some((m) => m.token === 'fullname'));
});

test('a deleted contact counts as no contact', () => {
  const ctx = fullCtx();
  ctx.contacts.c1 = clientContact({ deletedAt: '2026-01-01' });
  assert.equal(resolveTokens(KEY, ctx).missing.find((m) => m.token === 'ssn').reason, 'no-client-contact');
});

test('an optional token missing does not carry required', () => {
  // A blank "referred from" must never block a records request.
  const ctx = fullCtx({ sections: { intake: { fields: {}, rows: [] } } });
  const referred = resolveTokens(KEY, ctx).missing.find((m) => m.token === 'intake.referredfrom.lastFirst');
  assert.equal(referred.required, false);
});

test('address parts map postal onto Filevine\'s zip token', () => {
  // The column is `postal`. The token says `zip`. Reconciling the two is the
  // manifest's entire job, and doing it anywhere else means doing it twice.
  const { values } = resolveTokens(KEY, fullCtx());
  assert.equal(values['meds.provider.address1zip'], '77074');
});

/* ------------------------------------------------------------------ *
 * contactFromCell
 * ------------------------------------------------------------------ */

test('contactFromCell reads both shapes a cell can hold', () => {
  const contacts = { p1: provider() };
  assert.equal(contactFromCell({ id: 'p1', name: 'x' }, contacts).contact?.id, 'p1');
  assert.equal(contactFromCell('Just A Name', contacts).contact, null);
  assert.equal(contactFromCell('Just A Name', contacts).name, 'Just A Name');
  assert.equal(contactFromCell('', contacts).name, '');
  assert.equal(contactFromCell(undefined, contacts).contact, null);
});

test('contactFromCell keeps the stored name when the contact is gone', () => {
  // A deleted contact must still read as something rather than vanishing.
  const gone = contactFromCell({ id: 'p9', name: 'Closed Clinic' }, {});
  assert.equal(gone.contact, null);
  assert.equal(gone.name, 'Closed Clinic');
});

/* ------------------------------------------------------------------ *
 * Filenames
 * ------------------------------------------------------------------ */

test('the filename names the provider and the date', () => {
  const name = documentFilename(KEY, { 'meds.provider.name': 'Memorial Hermann Southwest' }, { date: '2026-09-23' });
  assert.equal(name, 'Medical Records Request — Memorial Hermann Southwest 2026-09-23.docx');
});

test('⚠️ a provider name with a slash cannot become a folder', () => {
  const name = documentFilename(KEY, { 'meds.provider.name': 'Memorial Hermann / Southwest' });
  assert.ok(!name.includes('/'));
  assert.match(name, /Memorial Hermann Southwest/);
});

test('an unnamed provider still yields a usable filename', () => {
  assert.equal(documentFilename(KEY, {}), 'Medical Records Request.docx');
});

test('a very long provider name is capped', () => {
  const name = documentFilename(KEY, { 'meds.provider.name': 'A'.repeat(400) });
  assert.ok(name.length <= 190, `got ${name.length}`);
});

/* ------------------------------------------------------------------ *
 * The manifest and the template must agree
 * ------------------------------------------------------------------ */

test('⚠️ every token in the .docx is mapped, and every mapping is used', async () => {
  /*
   * BOTH DIRECTIONS, ON PURPOSE. Editing the template to add a field and
   * forgetting to map it would print `{{…}}` on firm letterhead; removing one
   * and leaving the mapping would quietly stop resolving something a later
   * template still needs. This fails the build in either case.
   */
  const template = TEMPLATE_BY_KEY[KEY];
  const bytes = new Uint8Array(readFileSync(new URL(`../templates/${template.file}`, import.meta.url)));

  const inFile = (await scanTokens(bytes)).sort();
  const inManifest = Object.keys(template.tokens).sort();
  assert.deepEqual(inFile, inManifest);
});

test('every template files into a folder the firm actually uses', () => {
  // Same guard the section registry carries: a stray folder name silently
  // creates a second folder beside the one staff have used for years.
  for (const t of TEMPLATES) {
    assert.ok(DRIVE_FOLDERS.includes(t.driveFolder), `${t.key} files into "${t.driveFolder}"`);
  }
});

test('every template writes into a driveFile column that exists', () => {
  for (const t of TEMPLATES) {
    const section = SECTIONS.find((s) => s.key === t.sectionKey);
    assert.ok(section, `${t.key} names a section that does not exist`);
    const collection = (section.collections || [section.collection]).find((c) => c?.storageKey === t.storageKey);
    assert.ok(collection, `${t.key} names a collection that does not exist`);
    const column = collection.columns.find((c) => c.key === t.targetField);
    assert.ok(column, `${t.key} writes into a column that does not exist`);
    assert.equal(column.type, 'driveFile', `${t.key}'s target must hold one document`);
  }
});

test('every template carries the word the button should say', () => {
  // A row action people use many times a day needs a label, not a glyph. The
  // first version shipped as a bare icon beside the delete icon and nobody
  // could find it.
  for (const t of TEMPLATES) {
    assert.ok(t.button && t.button.length <= 12, `${t.key} needs a short button label`);
  }
});

test('template keys are unique, and lookups work', () => {
  const keys = TEMPLATES.map((t) => t.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(templatesFor('meds').length, 1);
  assert.deepEqual(templatesFor('expenses'), []);
});

test('an unknown template is refused rather than guessed at', () => {
  assert.throws(() => resolveTokens('nope', fullCtx()), /Unknown document template/);
});
