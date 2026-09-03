import test from 'node:test';
import assert from 'node:assert/strict';
import { SECTIONS } from './registry.js';
import { FIELD_BY_KEY, FIELDS } from '../domain/fields.js';

/**
 * A section field is stored in matter_section_data. A matter field is stored
 * on the matter row itself, and that is where every deadline feature looks --
 * chain.js, the calendar, the dashboard countdown, the projects table.
 *
 * When a section declares a field whose key is also a matter field, those two
 * facts collide: the tab looks like it is capturing the date and is in fact
 * writing it somewhere nothing reads. That is exactly what happened with the
 * SOL on the Intake tab, and it is invisible on screen -- the value persists
 * and reloads correctly, it simply never becomes a deadline.
 *
 * GenericSection now resolves the collision by routing any such field to
 * updateMatterField. This test exists so the collision set stays a decision
 * someone makes on purpose: add a matter-keyed field to a section and this
 * fails, which is the prompt to confirm the routing is what you want.
 */

function sectionFields(section) {
  const out = [];
  for (const g of section.groups || []) out.push(...(g.fields || []));
  out.push(...(section.fields || []));
  return out;
}

function collisions() {
  const found = [];
  for (const section of Object.values(SECTIONS)) {
    for (const f of sectionFields(section)) {
      const mf = FIELD_BY_KEY[f.key];
      if (mf && mf.type !== 'yesnoDoc') {
        found.push(`${section.key}.${f.key}`);
      }
    }
  }
  return found.sort();
}

test('section fields that share a key with a matter field are known', () => {
  assert.deepEqual(collisions(), ['intake.sol']);
});

test('SOL is a matter field, so the Intake tab writes it to the matter', () => {
  const sol = FIELD_BY_KEY.sol;
  assert.ok(sol, 'sol must be a matter field');
  assert.equal(sol.type, 'date');
  assert.ok(sol.highStakes, 'a missed SOL ends the case, so it is high stakes');
});

test('every high-stakes date is reachable from Case Info', () => {
  // The three dates the chain regenerates from. If one stops being editable
  // there is no other route to it.
  const highStakes = FIELDS.filter((f) => f.highStakes).map((f) => f.key).sort();
  assert.deepEqual(highStakes, ['dco', 'sol', 'trialDate']);
  for (const key of highStakes) {
    assert.equal(FIELD_BY_KEY[key].section, 'Case Info');
  }
});

test('no section declares a field key twice', () => {
  for (const section of Object.values(SECTIONS)) {
    const keys = sectionFields(section).map((f) => f.key);
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    assert.deepEqual(dupes, [], `${section.key} declares ${dupes.join(', ')} twice`);
  }
});

/* ------------------------------------------------------------------ *
 * The firm's tweaks — config the UI depends on
 * ------------------------------------------------------------------ */

function medsColumns() {
  const meds = SECTIONS.find((x) => x.label === 'Medicals');
  const table = meds.collections.find((c) => c.storageKey === 'meds');
  return table.columns;
}

test('Payments or Reductions is gone from the provider table', () => {
  assert.equal(medsColumns().some((c) => c.key === 'paymentsorreductions'), false);
});

test('NOFA Filed? is a yes/no/unknown on the provider table', () => {
  const col = medsColumns().find((c) => c.key === 'nofafiled');
  assert.ok(col, 'NOFA Filed? should exist');
  assert.equal(col.type, 'yesnounknown');
});

test('records and bills are separate attachment boxes, sitting together', () => {
  /*
   * The complaint was that one drop box sat mid-row and the other at the far
   * end, so filing a request and filing what came back meant scrolling the
   * width of the table. Adjacency is the fix, so adjacency is the assertion.
   */
  const keys = medsColumns().map((c) => c.key);
  const req = keys.indexOf('recordsrequestsharelink');
  const records = keys.indexOf('medicalrecordsandbills');
  const bills = keys.indexOf('bills');

  assert.ok(req >= 0 && records >= 0 && bills >= 0, 'all three boxes exist');
  assert.equal(records, req + 1, 'Medical Records must follow the request box');
  assert.equal(bills, records + 1, 'Bills must follow Medical Records');
});

test('the records box keeps its old key, so dropped files are not orphaned', () => {
  /*
   * Its LABEL changed to "Medical Records"; its KEY must not. Attachments on
   * 344 cases are stored against the key, and renaming it would hide every one
   * of them. This test is the guard on that.
   */
  const col = medsColumns().find((c) => c.key === 'medicalrecordsandbills');
  assert.ok(col, 'the key medicalrecordsandbills must survive');
  assert.equal(col.label, 'Medical Records');
});

test('expense types match the firm\'s Filevine list', () => {
  const expenses = SECTIONS.find((x) => x.label === 'Expenses');
  const type = expenses.collection.columns.find((c) => c.key === 'type');
  for (const t of [
    'Administration', 'Advance', 'Filevine AI', 'Court Filing Fee', 'Crash Report',
    'Deposition Transcript', 'Expert Report', 'Interpreter', 'Mileage', 'Notary',
    'Searches', 'Taxi/Uber', 'Toll Road', 'Trial Materials', 'Zoom', 'Other',
  ]) {
    assert.ok(type.options.includes(t), `missing expense type: ${t}`);
  }
  // Superseded by Court Filing Fee / Expert Report, and deliberately dropped.
  // Rows still holding them are covered by orphanedOption, not by this list.
  for (const gone of ['Filing Fee', 'Expert', 'Court Reporter']) {
    assert.equal(type.options.includes(gone), false, `${gone} should be retired`);
  }
});

test('the new deposition fields exist, beside the other yes/no columns', () => {
  const depos = SECTIONS.find((x) => x.label === 'Depositions');
  const cols = depos.collection.columns;
  const keys = cols.map((c) => c.key);

  const prepped = cols.find((c) => c.key === 'clientprepped');
  const prepDate = cols.find((c) => c.key === 'prepdate');
  assert.ok(prepped && prepDate, 'Client Prepped and Prep Date should both exist');
  assert.equal(prepped.type, 'yesnounknown');
  assert.equal(prepDate.type, 'date');
  // Read together: a depo scheduled with an unprepped client is the thing
  // worth spotting, so they sit next to "Deposition Taken".
  assert.equal(keys.indexOf('clientprepped'), keys.indexOf('depositiontaken') + 1);
  assert.equal(keys.indexOf('prepdate'), keys.indexOf('clientprepped') + 1);
});

test('discovery types are the firm\'s, not the instrument-level list', () => {
  const disc = SECTIONS.find((x) => x.key === 'discovery');
  const type = disc.collection.columns.find((c) => c.key === 'type');
  assert.deepEqual(type.options, [
    'Unknown',
    'Discovery Request',
    'Discovery Responses',
    "Defendant's Initial Disclosures",
    "Plaintiff's Initial Disclosures",
  ]);
  // The retired instrument names must be gone from the OPTIONS. Rows still
  // holding one keep it via orphanedOption, which is tested in fields.test.js.
  for (const gone of ['Interrogatories', 'Requests for Production', 'Requests for Disclosure', 'Subpoena']) {
    assert.equal(type.options.includes(gone), false, `${gone} should be retired`);
  }
});

test('the checklist keys the deadline engine reads are untouched by the relabel', () => {
  /*
   * The Discovery items were renamed at the firm's request. chain.js computes
   * Rule 196/197 deadlines from these KEYS, and 346 cases store their ticks
   * against them. A rename here would break the rules and orphan the data, and
   * neither would announce itself.
   */
  for (const [key, label] of [
    ['plDiscoverySent', "Plaintiff's Discovery Request"],
    ['plDiscoveryAnswered', "Plaintiff's Discovery Responses"],
    ['defDiscoveryReceived', "Defendant's Discovery Request"],
    ['defDiscoveryAnswered', "Defendant's Discovery Responses"],
  ]) {
    assert.equal(FIELD_BY_KEY[key]?.label, label, `${key} should be labelled "${label}"`);
  }
});

test('the two new checklist items sit under the ones they follow', () => {
  // This array's order IS what each tab renders, and a counter-affidavit comes
  // after ours by definition.
  const keys = FIELDS.filter((f) => f.type === 'yesnoDoc').map((f) => f.key);
  assert.equal(keys.indexOf('counterAffidavitsFiled'), keys.indexOf('affidavitsFiled') + 1);
  assert.equal(keys.indexOf('damagedWitnessDepo'), keys.indexOf('defDepo') + 1);
});
