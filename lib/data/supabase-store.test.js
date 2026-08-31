import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSupabaseStore, rowsToMatters, toColumnValue, toNumber,
  activityRowToEntry, taskRowToTask, COLUMN_OF, KEY_OF,
} from './supabase-store.js';
import { fakeSupabase } from './fake-supabase.js';
import { FIELDS, DOC_FIELDS } from '../domain/fields.js';

/*
 * The 635 lines between the firm's staff and their database, which had no
 * tests at all until this file. The store could not even be imported by the
 * test runner -- see scripts/test-alias.mjs.
 *
 * The bugs this layer has actually shipped were all invisible on screen: a
 * column written but never read back, a save that looked fine and stored
 * nothing where anything reads it. So these tests assert on STATE -- what the
 * rows say afterwards -- not on which methods were called.
 */

const matterRow = (over = {}) => ({
  id: 'm1',
  client_name: 'Rivera, Marcus',
  case_number: '26-001',
  status: 'Open',
  open_date: '2026-01-05',
  doa: null,
  sol: null,
  trial_date: null,
  dco: null,
  settlement_amount: null,
  created_at: '2026-01-05T00:00:00Z',
  last_activity_at: '2026-08-20T00:00:00Z',
  deleted_at: null,
  extra: null,
  ...over,
});

/* ------------------------------------------------------------------ *
 * Column mapping — write side and read side must agree
 * ------------------------------------------------------------------ */

test('every mapped column round-trips back to the key it came from', () => {
  // A column mapped on write but missing on read is exactly how the Docs tab
  // came to show a file count and "no folder linked" at the same time.
  for (const [key, column] of Object.entries(COLUMN_OF)) {
    assert.equal(KEY_OF[column], key, `${column} does not map back to ${key}`);
  }
  assert.equal(Object.keys(KEY_OF).length, Object.keys(COLUMN_OF).length);
});

test('every scalar app field has a column or is deliberately in the tail', () => {
  const scalar = FIELDS.filter((f) => !DOC_FIELDS.has(f.key)).map((f) => f.key);
  const unmapped = scalar.filter((k) => !COLUMN_OF[k]);
  // If this list grows, the new field is going into `extra` as JSONB. That is
  // supported, but it should be a decision rather than an oversight.
  assert.deepEqual(unmapped, []);
});

test('the Drive folder columns are read back', () => {
  const out = rowsToMatters([matterRow({ drive_folder_id: 'f1', drive_folder_name: 'Rivera' })], []);
  assert.equal(out.m1.driveFolderId, 'f1');
  assert.equal(out.m1.driveFolderName, 'Rivera');
});

test('a null column does not become the string "null"', () => {
  const out = rowsToMatters([matterRow({ sol: null, doa: undefined })], []);
  assert.equal(out.m1.values.sol, '');
  assert.equal(out.m1.values.doa, '');
});

test('checklist rows nest under their field key', () => {
  const out = rowsToMatters(
    [matterRow()],
    [{ matter_id: 'm1', field_key: 'served', done: true, occurred_on: '2026-03-01', doc_url: null, note: null }],
  );
  assert.deepEqual(out.m1.values.served, { done: true, date: '2026-03-01', docUrl: '', note: '' });
});

test('a checklist row for another matter does not leak across', () => {
  const out = rowsToMatters(
    [matterRow({ id: 'm1' }), matterRow({ id: 'm2', case_number: '26-002' })],
    [{ matter_id: 'm2', field_key: 'served', done: true, occurred_on: null, doc_url: null, note: null }],
  );
  assert.equal(out.m1.values.served.done, false);
  assert.equal(out.m2.values.served.done, true);
});

test('the JSONB tail fills gaps but never overwrites a real column', () => {
  const out = rowsToMatters(
    [matterRow({ case_number: '26-001', extra: { caseNumber: 'WRONG', adjuster: 'Kim' } })],
    [],
  );
  assert.equal(out.m1.values.caseNumber, '26-001');
  assert.equal(out.m1.values.adjuster, 'Kim');
});

test('a soft-deleted matter reports when it was archived', () => {
  const out = rowsToMatters([matterRow({ deleted_at: '2026-07-01T00:00:00Z' })], []);
  assert.equal(out.m1.archivedAt, '2026-07-01T00:00:00Z');
  assert.equal(rowsToMatters([matterRow()], []).m1.archivedAt, undefined);
});

test('empty input yields an empty map rather than throwing', () => {
  assert.deepEqual(rowsToMatters(null, null), {});
  assert.deepEqual(rowsToMatters([], []), {});
});

/* ------------------------------------------------------------------ *
 * Value coercion — '' is not a date
 * ------------------------------------------------------------------ */

test('an empty string becomes null, because Postgres will not take it as a date', () => {
  for (const column of ['sol', 'doa', 'trial_date', 'status', 'insurance_class', 'settlement_amount']) {
    assert.equal(toColumnValue(column, ''), null, `${column} should null out`);
  }
  assert.equal(toColumnValue('client_name', ''), null);
  assert.equal(toColumnValue('sol', '2026-10-15'), '2026-10-15');
});

test('undefined is treated as absent, not as a value', () => {
  assert.equal(toColumnValue('sol', undefined), null);
  assert.equal(toColumnValue('sol', null), null);
});

test('money parses out of whatever it was typed as', () => {
  assert.equal(toNumber('$125,000.50'), 125000.50);
  assert.equal(toNumber('125000'), 125000);
  assert.equal(toNumber(''), null);
  assert.equal(toNumber(null), null);
  assert.equal(toNumber('not money'), null);
});

/* ------------------------------------------------------------------ *
 * Row -> entry mappers
 * ------------------------------------------------------------------ */

test('an activity row with no email headers still has a meta object', () => {
  const e = activityRowToEntry({ id: 'a1', matter_id: 'm1', kind: 'note', meta: null });
  assert.deepEqual(e.meta, {});
  assert.equal(e.author, 'Unknown');
});

test('a task with no assignee reads as Unassigned', () => {
  const t = taskRowToTask({ id: 't1', matter_id: 'm1', title: 'SOL', assigned_to: null });
  assert.equal(t.assignedTo, 'Unassigned');
  assert.equal(t.completed, false);
});

/* ------------------------------------------------------------------ *
 * createMatter
 * ------------------------------------------------------------------ */

test('creating a matter allocates a case number and stores the row', async () => {
  const db = fakeSupabase({ matter: [] }, { rpc: { allocate_case_number: '26-007' } });
  const store = createSupabaseStore(db);

  const r = await store.createMatter({ clientName: 'Okafor, Ada' });
  assert.equal(r.ok, true);
  assert.equal(r.caseNumber, '26-007');

  const [row] = db._rows('matter');
  assert.equal(row.client_name, 'Okafor, Ada');
  assert.equal(row.case_number, '26-007');
  assert.equal(row.status, 'Open');
});

test('a failed case-number allocation fails the create instead of making a numberless matter', async () => {
  // This was swallowed. One numberless case is a nuisance; sixty during an
  // import is a file you cannot tell from the next one.
  const db = fakeSupabase(
    { matter: [] },
    { rpc: { allocate_case_number: new Error('permission denied for function allocate_case_number') } },
  );
  const store = createSupabaseStore(db);

  const r = await store.createMatter({ clientName: 'Okafor, Ada' });
  assert.equal(r.ok, false);
  assert.match(r.error, /case number/i);
  assert.equal(db._rows('matter').length, 0, 'nothing should have been written');
});

test('an explicit case number is kept and no number is burned', async () => {
  const db = fakeSupabase({ matter: [] }, { rpc: { allocate_case_number: '26-999' } });
  const store = createSupabaseStore(db);

  await store.createMatter({ clientName: 'Okafor, Ada', caseNumber: '26-050' });
  assert.equal(db._rows('matter')[0].case_number, '26-050');
  assert.ok(!db._calls.some((c) => c.op === 'rpc:allocate_case_number'));
});

/* ------------------------------------------------------------------ *
 * updateMatterField
 * ------------------------------------------------------------------ */

test('a known field writes its column', async () => {
  const db = fakeSupabase({ matter: [matterRow()] });
  const store = createSupabaseStore(db);

  await store.updateMatterField('m1', 'opposingCounsel', 'Reyes & Cole');
  assert.equal(db._rows('matter')[0].opposing_counsel, 'Reyes & Cole');
});

test('an unknown field lands in the JSONB tail rather than being dropped', async () => {
  const db = fakeSupabase({ matter: [matterRow()] });
  const store = createSupabaseStore(db);

  await store.updateMatterField('m1', 'adjusterPhone', '713-555-0100');
  assert.deepEqual(db._rows('matter')[0].extra, { adjusterPhone: '713-555-0100' });
});

test('the tail accumulates instead of replacing itself', async () => {
  const db = fakeSupabase({ matter: [matterRow({ extra: { adjuster: 'Kim' } })] });
  const store = createSupabaseStore(db);

  await store.updateMatterField('m1', 'adjusterPhone', '713-555-0100');
  assert.deepEqual(db._rows('matter')[0].extra, { adjuster: 'Kim', adjusterPhone: '713-555-0100' });
});

test('clearing a date writes null, not an empty string', async () => {
  const db = fakeSupabase({ matter: [matterRow({ sol: '2026-10-15' })] });
  const store = createSupabaseStore(db);

  await store.updateMatterField('m1', 'sol', '');
  assert.equal(db._rows('matter')[0].sol, null);
});

test('a checklist field is routed to the checklist table, not a matter column', async () => {
  const db = fakeSupabase({ matter: [matterRow()], matter_checklist_item: [] });
  const store = createSupabaseStore(db);

  await store.updateMatterField('m1', 'served', { done: true, date: '2026-03-01' });

  const [item] = db._rows('matter_checklist_item');
  assert.equal(item.matter_id, 'm1');
  assert.equal(item.field_key, 'served');
  assert.equal(item.done, true);
  assert.equal(item.occurred_on, '2026-03-01');
});

test('a checklist update merges rather than clearing the fields it was not given', async () => {
  const db = fakeSupabase({
    matter: [matterRow()],
    matter_checklist_item: [{
      matter_id: 'm1', field_key: 'served', done: true,
      occurred_on: '2026-03-01', doc_url: 'https://drive/x', note: 'by certified mail',
    }],
  });
  const store = createSupabaseStore(db);

  await store.updateMatterField('m1', 'served', { note: 'by process server' });

  const [item] = db._rows('matter_checklist_item');
  assert.equal(item.note, 'by process server');
  assert.equal(item.done, true, 'done must survive');
  assert.equal(item.occurred_on, '2026-03-01', 'the date must survive');
  assert.equal(item.doc_url, 'https://drive/x', 'the document link must survive');
});

/* ------------------------------------------------------------------ *
 * importMatters
 * ------------------------------------------------------------------ */

test('an import creates numbered rows and reads their ids back by case number', async () => {
  const db = fakeSupabase({ matter: [], matter_checklist_item: [] });
  const store = createSupabaseStore(db);

  const r = await store.importMatters([
    { rowIndex: 0, action: 'create', values: { clientName: 'Okafor, Ada', caseNumber: '26-002', sol: '2027-01-20' }, checklist: {} },
    { rowIndex: 1, action: 'create', values: { clientName: 'Nguyen, Thanh', caseNumber: '26-003' }, checklist: {} },
  ]);

  assert.equal(r.ok, true);
  assert.equal(r.created, 2);
  const rows = db._rows('matter');
  assert.equal(rows.length, 2);
  assert.equal(rows.find((x) => x.case_number === '26-002').sol, '2027-01-20');
});

test('an import never blanks a field the file did not mention', async () => {
  // The whole reason import is safe to re-run. A spreadsheet of SOLs must not
  // erase the trial dates entered last week.
  const db = fakeSupabase({
    matter: [matterRow({ id: 'm1', sol: '2026-10-15', trial_date: '2026-11-20', attorney: 'PH' })],
    matter_checklist_item: [],
  });
  const store = createSupabaseStore(db);

  await store.importMatters([
    { rowIndex: 0, action: 'update', matterId: 'm1', values: { clientName: 'Rivera, Marcus', caseNumber: '26-001' }, checklist: {} },
  ]);

  const [row] = db._rows('matter');
  assert.equal(row.sol, '2026-10-15');
  assert.equal(row.trial_date, '2026-11-20');
  assert.equal(row.attorney, 'PH');
});

test('checklist items attach to the matter that owns them', async () => {
  const db = fakeSupabase({ matter: [], matter_checklist_item: [] });
  const store = createSupabaseStore(db);

  await store.importMatters([
    {
      rowIndex: 0, action: 'create', checklist: { served: { done: true, date: '2026-03-01', note: '' } },
      values: { clientName: 'Okafor, Ada', caseNumber: '26-002' },
    },
    {
      rowIndex: 1, action: 'create', checklist: { served: { done: false, date: '', note: 'waiting' } },
      values: { clientName: 'Nguyen, Thanh', caseNumber: '26-003' },
    },
  ]);

  const matters = db._rows('matter');
  const ada = matters.find((m) => m.case_number === '26-002');
  const thanh = matters.find((m) => m.case_number === '26-003');
  const items = db._rows('matter_checklist_item');

  assert.equal(items.find((i) => i.matter_id === ada.id).done, true);
  assert.equal(items.find((i) => i.matter_id === thanh.id).done, false);
  assert.equal(items.find((i) => i.matter_id === thanh.id).note, 'waiting');
});

test('a row with no case number still gets its own checklist items', async () => {
  // These are inserted one at a time precisely so the id is unambiguous.
  const db = fakeSupabase({ matter: [], matter_checklist_item: [] });
  const store = createSupabaseStore(db);

  await store.importMatters([
    {
      rowIndex: 0, action: 'create', checklist: { suitFiled: { done: true, date: '2026-02-01', note: '' } },
      values: { clientName: 'Bergstrom, Lena' },
    },
  ]);

  const [matter] = db._rows('matter');
  const [item] = db._rows('matter_checklist_item');
  // The column is left out of the insert entirely, so Postgres defaults it to
  // NULL. What matters is that no number was invented -- one that matches
  // nothing in the firm's paper file is worse than an empty column.
  assert.ok(!matter.case_number, 'no number is invented');
  assert.equal(item.matter_id, matter.id);
  assert.equal(item.occurred_on, '2026-02-01');
});

test('re-importing the same checklist item updates it rather than duplicating', async () => {
  const db = fakeSupabase({ matter: [matterRow()], matter_checklist_item: [] });
  const store = createSupabaseStore(db);

  const entry = {
    rowIndex: 0, action: 'update', matterId: 'm1',
    values: { clientName: 'Rivera, Marcus' },
    checklist: { served: { done: true, date: '2026-03-01', note: '' } },
  };
  await store.importMatters([entry]);
  await store.importMatters([{ ...entry, checklist: { served: { done: true, date: '2026-03-05', note: '' } } }]);

  const items = db._rows('matter_checklist_item');
  assert.equal(items.length, 1);
  assert.equal(items[0].occurred_on, '2026-03-05');
});

test('a database failure is reported per row instead of being swallowed', async () => {
  const db = fakeSupabase(
    { matter: [], matter_checklist_item: [] },
    { failOn: [{ table: 'matter', op: 'insert', message: 'duplicate key value' }] },
  );
  const store = createSupabaseStore(db);

  const r = await store.importMatters([
    { rowIndex: 0, action: 'create', values: { clientName: 'Okafor, Ada', caseNumber: '26-002' }, checklist: {} },
  ]);

  assert.equal(r.ok, false);
  assert.equal(r.created, 0);
  assert.equal(r.failed.length, 1);
  assert.match(r.failed[0].error, /duplicate key/);
});

test('an empty plan is a no-op, not an error', async () => {
  const db = fakeSupabase({ matter: [] });
  const store = createSupabaseStore(db);
  const r = await store.importMatters([]);
  assert.deepEqual(r, { ok: true, created: 0, updated: 0, failed: [] });
});

/* ------------------------------------------------------------------ *
 * The deadline chain — the reason any of this matters
 * ------------------------------------------------------------------ */

test('setting an SOL generates the statute-of-limitations deadline', async () => {
  const db = fakeSupabase({
    matter: [matterRow({ sol: null })],
    matter_checklist_item: [],
    activity: [],
  });
  const store = createSupabaseStore(db);

  await store.updateMatterField('m1', 'sol', '2026-10-15');

  const auto = db._rows('activity').filter((a) => a.source === 'auto');
  const sol = auto.find((a) => a.rule_key === 'sol');
  assert.ok(sol, 'an SOL deadline should exist');
  assert.equal(sol.due_date, '2026-10-15');
  assert.equal(sol.matter_id, 'm1');
  assert.equal(sol.kind, 'task');
});

test('moving the SOL moves the deadline instead of adding a second one', async () => {
  const db = fakeSupabase({
    matter: [matterRow({ sol: null })],
    matter_checklist_item: [],
    activity: [],
  });
  const store = createSupabaseStore(db);

  await store.updateMatterField('m1', 'sol', '2026-10-15');
  await store.updateMatterField('m1', 'sol', '2026-11-01');

  const sols = db._rows('activity').filter((a) => a.rule_key === 'sol');
  assert.equal(sols.length, 1, 'the deadline is upserted, not duplicated');
  assert.equal(sols[0].due_date, '2026-11-01');
});

test('clearing the SOL retracts the deadline', async () => {
  const db = fakeSupabase({
    matter: [matterRow({ sol: '2026-10-15' })],
    matter_checklist_item: [],
    activity: [{
      id: 'a1', matter_id: 'm1', kind: 'task', source: 'auto', rule_key: 'sol',
      title: 'Statute of Limitations', due_date: '2026-10-15',
      completed: false, manual_override: false,
    }],
  });
  const store = createSupabaseStore(db);

  await store.updateMatterField('m1', 'sol', '');

  const sols = db._rows('activity').filter((a) => a.rule_key === 'sol');
  assert.equal(sols.length, 0);
});

test('a completed deadline survives its trigger disappearing', async () => {
  // Deleting the record that someone already marked done would erase work,
  // so retraction deliberately spares completed and manually-overridden rows.
  const db = fakeSupabase({
    matter: [matterRow({ sol: '2026-10-15' })],
    matter_checklist_item: [],
    activity: [{
      id: 'a1', matter_id: 'm1', kind: 'task', source: 'auto', rule_key: 'sol',
      title: 'Statute of Limitations', due_date: '2026-10-15',
      completed: true, manual_override: false,
    }],
  });
  const store = createSupabaseStore(db);

  await store.updateMatterField('m1', 'sol', '');

  assert.equal(db._rows('activity').filter((a) => a.rule_key === 'sol').length, 1);
});

test('editing something unrelated does not touch the deadlines', async () => {
  const db = fakeSupabase({
    matter: [matterRow({ sol: '2026-10-15' })],
    matter_checklist_item: [],
    activity: [],
  });
  const store = createSupabaseStore(db);

  await store.updateMatterField('m1', 'opposingCounsel', 'Reyes & Cole');
  assert.equal(db._rows('activity').length, 0, 'only the date fields regenerate the chain');
});

/* ------------------------------------------------------------------ *
 * loadAll
 * ------------------------------------------------------------------ */

test('loadAll returns the app shape, not raw rows', async () => {
  const db = fakeSupabase({
    matter: [matterRow({ sol: '2026-10-15', drive_folder_id: 'f1' })],
    matter_checklist_item: [
      { matter_id: 'm1', field_key: 'served', done: true, occurred_on: '2026-03-01', doc_url: null, note: null },
    ],
    activity: [],
    matter_section_data: [],
    matter_section_row: [],
    profile: [],
    matter_relation: [],
  });
  const store = createSupabaseStore(db);

  const data = await store.loadAll();
  assert.equal(data.matters.m1.values.clientName, 'Rivera, Marcus');
  assert.equal(data.matters.m1.values.sol, '2026-10-15');
  assert.equal(data.matters.m1.values.served.done, true);
  assert.equal(data.matters.m1.driveFolderId, 'f1');
});

/* ------------------------------------------------------------------ *
 * Section data and rows — where the medical bills live
 * ------------------------------------------------------------------ */

test('a section field merges into that section rather than replacing it', async () => {
  const db = fakeSupabase({
    matter_section_data: [{ matter_id: 'm1', section_key: 'intake', fields: { incidentdate: '2024-10-15' } }],
  });
  const store = createSupabaseStore(db);

  await store.setSectionField('m1', 'intake', 'personperformingintake', 'Dana Ortiz');

  const [row] = db._rows('matter_section_data');
  assert.deepEqual(row.fields, { incidentdate: '2024-10-15', personperformingintake: 'Dana Ortiz' });
});

test('two sections on the same matter do not overwrite each other', async () => {
  const db = fakeSupabase({ matter_section_data: [] });
  const store = createSupabaseStore(db);

  await store.setSectionField('m1', 'intake', 'a', '1');
  await store.setSectionField('m1', 'medicals', 'b', '2');

  const rows = db._rows('matter_section_data');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.find((r) => r.section_key === 'intake').fields, { a: '1' });
  assert.deepEqual(rows.find((r) => r.section_key === 'medicals').fields, { b: '2' });
});

test('provider rows are added in order, so the ledger keeps its sequence', async () => {
  const db = fakeSupabase({ matter_section_row: [] });
  const store = createSupabaseStore(db);

  await store.addSectionRow('m1', 'meds', { provider: 'Lakeside PT', amount: '12500' });
  await store.addSectionRow('m1', 'meds', { provider: 'Northside Urgent Care', amount: '8400' });

  const rows = db._rows('matter_section_row');
  assert.deepEqual(rows.map((r) => r.ordinal), [0, 1]);
  assert.equal(rows[1].data.provider, 'Northside Urgent Care');
});

test('rows are numbered per section, not per matter', async () => {
  const db = fakeSupabase({ matter_section_row: [] });
  const store = createSupabaseStore(db);

  await store.addSectionRow('m1', 'meds', { provider: 'Lakeside PT' });
  await store.addSectionRow('m1', 'expenses', { item: 'Filing fee' });

  const rows = db._rows('matter_section_row');
  assert.equal(rows.find((r) => r.section_key === 'expenses').ordinal, 0);
});

test('editing a provider row keeps the fields it was not given', async () => {
  // The amount feeds the settlement disbursement. Losing it while correcting a
  // spelling would change what the client is told they are owed.
  const db = fakeSupabase({
    matter_section_row: [{ id: 'r1', matter_id: 'm1', section_key: 'meds', ordinal: 0, data: { provider: 'Lakeside PT', amount: '12500' } }],
  });
  const store = createSupabaseStore(db);

  await store.updateSectionRow('m1', 'meds', 'r1', { provider: 'Lakeside Physical Therapy' });

  const [row] = db._rows('matter_section_row');
  assert.equal(row.data.provider, 'Lakeside Physical Therapy');
  assert.equal(row.data.amount, '12500');
});

test('deleting a row removes only that row', async () => {
  const db = fakeSupabase({
    matter_section_row: [
      { id: 'r1', matter_id: 'm1', section_key: 'meds', data: { provider: 'A' } },
      { id: 'r2', matter_id: 'm1', section_key: 'meds', data: { provider: 'B' } },
    ],
  });
  const store = createSupabaseStore(db);

  await store.deleteSectionRow('m1', 'meds', 'r1');

  const rows = db._rows('matter_section_row');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'r2');
});

/* ------------------------------------------------------------------ *
 * Archiving is a soft delete
 * ------------------------------------------------------------------ */

test('archiving stamps deleted_at and keeps the row', async () => {
  const db = fakeSupabase({ matter: [matterRow()] });
  const store = createSupabaseStore(db);

  await store.archiveMatter('m1');

  const [row] = db._rows('matter');
  assert.ok(row.deleted_at, 'the row is marked, not removed');
  assert.equal(row.client_name, 'Rivera, Marcus');
});

test('unarchiving clears the stamp', async () => {
  const db = fakeSupabase({ matter: [matterRow({ deleted_at: '2026-07-01T00:00:00Z' })] });
  const store = createSupabaseStore(db);

  await store.unarchiveMatter('m1');
  assert.equal(db._rows('matter')[0].deleted_at, null);
});

test('archiving one matter leaves the others alone', async () => {
  const db = fakeSupabase({
    matter: [matterRow({ id: 'm1' }), matterRow({ id: 'm2', case_number: '26-002' })],
  });
  const store = createSupabaseStore(db);

  await store.archiveMatter('m1');

  const rows = db._rows('matter');
  assert.ok(rows.find((r) => r.id === 'm1').deleted_at);
  assert.equal(rows.find((r) => r.id === 'm2').deleted_at, null);
});
