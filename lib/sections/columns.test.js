import test from 'node:test';
import assert from 'node:assert/strict';
import { columnMinWidth, COLUMN_MIN_WIDTH, DEFAULT_MIN_WIDTH } from '@/lib/sections/columns';
import { SECTIONS } from '@/lib/sections/registry';

/** Every column type the registry actually uses, across every section. */
function typesInUse() {
  const types = new Set();
  for (const section of SECTIONS) {
    const collections = section.collections || (section.collection ? [section.collection] : []);
    for (const c of collections) for (const col of c.columns || []) types.add(col.type);
    for (const f of section.fields || []) types.add(f.type);
    for (const g of section.groups || []) for (const f of g.fields || []) types.add(f.type);
  }
  types.delete(undefined);
  return [...types];
}

test('EVERY COLUMN TYPE IN THE REGISTRY HAS A WIDTH', () => {
  /*
   * The test that earns its place. Adding a column type and forgetting to size
   * it does not fail anything -- it silently falls back to the default and the
   * column is too narrow, which is exactly how "Aguilar, Karen" came to render
   * as "Aguilar, Karer" in the first place.
   */
  const missing = typesInUse().filter((t) => !(t in COLUMN_MIN_WIDTH));
  assert.deepEqual(missing, [], `no width set for: ${missing.join(', ')}`);
});

test('a name column is wide enough for a real provider name', () => {
  // "Memorial Hermann Southwest" at 14px is roughly 175px, and the icon eats
  // 32px before the first character.
  assert.ok(columnMinWidth('contact') >= 190, 'contact must fit a hospital name');
  assert.ok(columnMinWidth('contact') > columnMinWidth('money'), 'names need more room than sums');
});

test('an unknown type still gets a usable width', () => {
  assert.equal(columnMinWidth('something-new'), DEFAULT_MIN_WIDTH);
  assert.equal(columnMinWidth(undefined), DEFAULT_MIN_WIDTH);
});

test('no column is so wide that a few of them cannot share a laptop screen', () => {
  // A guard against fixing clipping by making everything enormous. Five
  // average columns should still fit inside 1200px of content area.
  const avg = Object.values(COLUMN_MIN_WIDTH).reduce((a, b) => a + b, 0)
    / Object.values(COLUMN_MIN_WIDTH).length;
  assert.ok(avg * 5 < 1200, `average ${Math.round(avg)}px is too wide`);
});
