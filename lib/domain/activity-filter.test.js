import test from 'node:test';
import assert from 'node:assert/strict';
import { kindCounts, filterByKind, KIND_LABELS } from '@/lib/domain/activity-filter';

const entries = [
  { id: '1', kind: 'note' },
  { id: '2', kind: 'note' },
  { id: '3', kind: 'email' },
  { id: '4', kind: 'task' },
  { id: '5', kind: 'system' },
];

test('All leads, and counts everything including system entries', () => {
  const counts = kindCounts(entries);
  assert.deepEqual(counts[0], { key: 'all', label: 'All', count: 5 });
});

test('only the kinds actually on this case are offered', () => {
  /*
   * The enum allows eight. Offering all eight on every case means a row of
   * filters that mostly return nothing -- and a filter that returns nothing
   * reads as a fault rather than as an empty category.
   */
  const keys = kindCounts(entries).map((k) => k.key);
  assert.deepEqual(keys, ['all', 'note', 'email', 'task']);
  assert.ok(!keys.includes('call'), 'a kind with no entries was offered');
  assert.ok(!keys.includes('fax'));
});

test('system entries are counted but never offered as a category', () => {
  // Entries the app wrote about itself are not something anyone browses by.
  // They still appear under All.
  const keys = kindCounts(entries).map((k) => k.key);
  assert.ok(!keys.includes('system'));
  assert.ok(!('system' in KIND_LABELS));
});

test('the order is how the firm talks about them', () => {
  const all = [
    { kind: 'reminder' }, { kind: 'task' }, { kind: 'email' },
    { kind: 'text' }, { kind: 'call' }, { kind: 'note' }, { kind: 'fax' },
  ];
  assert.deepEqual(
    kindCounts(all).map((k) => k.key),
    ['all', 'note', 'call', 'text', 'email', 'task', 'fax', 'reminder']
  );
});

test('counts are per kind, not a running total', () => {
  const byKey = Object.fromEntries(kindCounts(entries).map((k) => [k.key, k.count]));
  assert.equal(byKey.note, 2);
  assert.equal(byKey.email, 1);
  assert.equal(byKey.task, 1);
});

test('filtering returns just that kind', () => {
  assert.deepEqual(filterByKind(entries, 'note').map((e) => e.id), ['1', '2']);
  assert.deepEqual(filterByKind(entries, 'task').map((e) => e.id), ['4']);
});

test('an unknown or absent filter shows everything, never nothing', () => {
  // A filter that silently empties the tab looks exactly like data loss --
  // which this firm has had enough of.
  for (const k of ['all', '', null, undefined, 'nonsense', 'system']) {
    assert.equal(filterByKind(entries, k).length, 5, `filter ${JSON.stringify(k)} hid entries`);
  }
});

test('a map of entries works as well as an array', () => {
  // `activity` is held as an object keyed by id.
  const asMap = Object.fromEntries(entries.map((e) => [e.id, e]));
  assert.equal(filterByKind(asMap, 'note').length, 2);
  assert.equal(kindCounts(asMap)[0].count, 5);
});

test('nothing at all is not a crash', () => {
  assert.deepEqual(kindCounts(), [{ key: 'all', label: 'All', count: 0 }]);
  assert.deepEqual(filterByKind(), []);
  assert.deepEqual(kindCounts([{ id: 'x' }]), [{ key: 'all', label: 'All', count: 1 }]);
});
