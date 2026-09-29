import test from 'node:test';
import assert from 'node:assert/strict';
import { SECTIONS } from './registry.js';
import { ITEM_LAYOUTS } from './item-layouts.js';
import {
  itemLayout, unplacedColumns, usesCards, displayValue, isEmptyValue, previewFields, filesOf, CARD_THRESHOLD,
} from './layout.js';

/** Every repeating table in the app, with the key its rows are stored under. */
const COLLECTIONS = SECTIONS.flatMap((s) =>
  (s.collections || (s.collection ? [s.collection] : [])).map((c) => ({ key: c.storageKey || s.key, c })));

/* ------------------------------------------------------------------ *
 * ⚠️ Every field reachable
 * ------------------------------------------------------------------ */

for (const { key, c } of COLLECTIONS) {
  test(`${key}: every column appears exactly once in its card layout`, () => {
    /*
     * THE ASSERTION THAT MATTERS MOST. A column missing from the layout is
     * data that exists and can be neither seen nor edited -- the fault this
     * app has hit six times. A column listed twice is two editors for one
     * value.
     */
    const placed = itemLayout(c).groups.flatMap((g) => g.fields.map((f) => f.key));
    assert.deepEqual([...placed].sort(), c.columns.map((x) => x.key).sort());
    assert.equal(new Set(placed).size, placed.length, 'no column placed twice');
  });
}

test('every wide table has a designed layout, with nothing left for "More"', () => {
  for (const { key, c } of COLLECTIONS) {
    if (!usesCards(c)) continue;
    assert.ok(c.item, `${key} has ${c.columns.length} columns and no layout in item-layouts.js`);
    assert.deepEqual(unplacedColumns(c), [], `${key}: these columns are not in its layout`);
  }
});

test('every key in item-layouts.js is a real column', () => {
  // A typo in a key would silently place nothing and push the real field into "More".
  const byKey = new Map(COLLECTIONS.map(({ key, c }) => [key, new Set(c.columns.map((x) => x.key))]));
  for (const [key, cfg] of Object.entries(ITEM_LAYOUTS)) {
    const cols = byKey.get(key);
    assert.ok(cols, `item-layouts.js names a table that does not exist: ${key}`);
    const listed = [cfg.left, cfg.right, cfg.status, ...cfg.groups.flatMap((g) => g.fields)].filter(Boolean);
    for (const k of listed) assert.ok(cols.has(k), `${key}.${k} is not a column`);
    assert.equal(new Set(listed).size, listed.length, `${key} lists a column twice`);
  }
});

test('a forgotten column is never dropped -- it lands in "More"', () => {
  const c = {
    columns: [{ key: 'a', type: 'text', label: 'A' }, { key: 'b', type: 'text', label: 'B' }],
    item: { left: 'a', groups: [] },
  };
  const layout = itemLayout(c);
  assert.ok(layout.groups.some((g) => g.fields.some((f) => f.key === 'b')));
});

test('a table with no layout still gets a sensible header', () => {
  const c = { columns: [
    { key: 'd', type: 'date', label: 'D' },
    { key: 'who', type: 'contact', label: 'Who' },
    { key: 'amt', type: 'money', label: 'Amt' },
  ] };
  const { left, right } = itemLayout(c);
  assert.equal(left, 'who');
  assert.equal(right, 'd');
});

test('only wide tables become cards', () => {
  for (const { c } of COLLECTIONS) assert.equal(usesCards(c), c.columns.length > CARD_THRESHOLD);
  // The ones staff named, for certain.
  const wide = new Set(COLLECTIONS.filter(({ c }) => usesCards(c)).map(({ key }) => key));
  for (const k of ['meds', 'expenses', 'liens', 'depositions']) assert.ok(wide.has(k), `${k} should be cards`);
});

test('notes, attachments and multi-selects take the full width of the editor', () => {
  const meds = COLLECTIONS.find(({ key }) => key === 'meds').c;
  const fields = itemLayout(meds).groups.flatMap((g) => g.fields);
  const full = (k) => fields.find((f) => f.key === k).full;
  assert.equal(full('notes'), true);
  assert.equal(full('bills'), true);
  assert.equal(full('billsordereddate'), false);
});

/* ------------------------------------------------------------------ *
 * ⚠️ Nothing reads "[object Object]"
 * ------------------------------------------------------------------ */

test('⚠️ no column of any table can display as "[object Object]"', () => {
  /*
   * A contact picked from the list is stored as { id, name }. String() of
   * that is how the calculator printed "[object Object]" for every provider.
   * Every column of every table, fed an object, must show text or nothing.
   */
  const shapes = [
    { id: 'c1', name: 'Memorial Hermann' },
    { dateValue: '2026-03-02', doneDate: '' },
    [{ id: 'f1', name: 'bill.pdf' }],
    { id: 'f1', name: 'request.docx', url: 'x' },
    { unexpected: true },
  ];
  for (const { key, c } of COLLECTIONS) {
    for (const col of c.columns) {
      for (const value of shapes) {
        const text = displayValue(col, value, {});
        assert.ok(!String(text).includes('[object'), `${key}.${col.key} showed "${text}"`);
      }
    }
  }
});

test('a contact shows its name in both shapes', () => {
  const col = { type: 'contact' };
  assert.equal(displayValue(col, { id: 'c1', name: 'Memorial Hermann' }), 'Memorial Hermann');
  assert.equal(displayValue(col, 'Northside Orthopaedics'), 'Northside Orthopaedics');
});

/* ------------------------------------------------------------------ *
 * Reading values
 * ------------------------------------------------------------------ */

test('money, dates and due/done dates read the way people write them', () => {
  assert.equal(displayValue({ type: 'money' }, '6000'), '$6,000.00');
  assert.equal(displayValue({ type: 'money' }, '$1,234.5'), '$1,234.50');
  assert.equal(displayValue({ type: 'date' }, '2026-03-02'), 'Mar 2, 2026');
  assert.equal(displayValue({ type: 'datedone' }, { dateValue: '2026-03-02', doneDate: '' }), 'Due Mar 2, 2026');
  assert.equal(displayValue({ type: 'datedone' }, { dateValue: '2026-03-02', doneDate: '2026-03-01' }), 'Due Mar 2, 2026 · Done Mar 1, 2026');
});

test('multi-selects, attachments and single documents', () => {
  assert.equal(displayValue({ type: 'multiselect' }, ['Check', 'Card']), 'Check, Card');
  assert.equal(displayValue({ type: 'attachments' }, [{ id: 'a' }, { id: 'b' }]), '2 files');
  assert.equal(displayValue({ type: 'attachments' }, [{ id: 'a' }]), '1 file');
  assert.equal(displayValue({ type: 'driveFile' }, { id: 'f', name: 'LOP.docx' }), 'LOP.docx');
  assert.deepEqual(filesOf({ type: 'attachments' }, [{ id: 'a', name: 'x' }]).map((f) => f.name), ['x']);
  assert.deepEqual(filesOf({ type: 'driveFile' }, { id: 'f', name: 'y' }).map((f) => f.name), ['y']);
});

test('a calculated column reads from its row', () => {
  const col = { type: 'calculated', inputs: ['amount', 'reduction'] };
  assert.equal(displayValue(col, undefined, { amount: '1000', reduction: '250' }), '$750.00');
});

test('empty means empty, in every shape', () => {
  assert.equal(isEmptyValue({ type: 'text' }, ''), true);
  assert.equal(isEmptyValue({ type: 'text' }, '   '), true);
  assert.equal(isEmptyValue({ type: 'text' }, null), true);
  assert.equal(isEmptyValue({ type: 'contact' }, { id: '', name: '' }), true);
  assert.equal(isEmptyValue({ type: 'datedone' }, { dateValue: '', doneDate: '' }), true);
  assert.equal(isEmptyValue({ type: 'attachments' }, []), true);
  assert.equal(isEmptyValue({ type: 'multiselect' }, []), true);
  assert.equal(isEmptyValue({ type: 'driveFile' }, {}), true);
  assert.equal(isEmptyValue({ type: 'yesnounknown' }, 'No'), false, '"No" is an answer, not a blank');
  assert.equal(isEmptyValue({ type: 'money' }, '0'), false, 'a zero amount is an answer');
});

test('the card preview shows filled fields only, and counts the rest', () => {
  const meds = COLLECTIONS.find(({ key }) => key === 'meds').c;
  const row = {
    provider: { id: 'c1', name: 'Memorial Hermann' },
    amount: '6000',
    plaintiffstreatmentstatus: 'Treating',
    datetreatmentstarted: '2025-03-02',
    notes: 'Balance disputed',
  };
  const { shown, empty } = previewFields(meds, row);
  const keys = shown.map((f) => f.key);
  assert.deepEqual(keys, ['datetreatmentstarted', 'notes'], 'header fields are not repeated in the body');
  assert.equal(empty, meds.columns.length - 3 - keys.length);
});
