import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * ⚠️ EVERY WRITER A PERSON TYPES INTO MUST BE QUEUED AND ECHO-SUPPRESSED.
 *
 * Reported 2026-09-28 by several staff at once: typing "Allstate" into
 * Insurance on Case Info came out "Alstate". updateMatterField wrote on every
 * keystroke and never marked the record as its own, so live sync played the
 * save of "Al" back over "All" a moment later -- the app erasing its user's
 * typing with its own previous save.
 *
 * The section fields had been fixed for exactly this (cf36dcb). The matter
 * path was missed because nothing checked it, and DataProvider has no
 * rendering tests. So this reads the source: crude, but it is the thing that
 * would have caught it, and it fails the build the moment a new typed writer
 * is added without the guard.
 */

const src = readFileSync(new URL('./DataProvider.jsx', import.meta.url), 'utf8');

/** The body of `const name = useCallback(` up to the next top-level `const … = useCallback(`. */
function body(name) {
  const start = src.indexOf(`const ${name} = useCallback(`);
  assert.ok(start >= 0, `${name} not found in DataProvider.jsx`);
  const rest = src.slice(start + 10);
  const next = rest.search(/\n  const \w+ = useCallback\(/);
  return next < 0 ? rest : rest.slice(0, next);
}

const TYPED_WRITERS = ['updateMatterField', 'setChecklistItem', 'setSectionField', 'updateSectionRow'];

for (const name of TYPED_WRITERS) {
  test(`${name} holds its record as ours while the person is typing`, () => {
    const b = body(name);
    assert.match(b, /touchLocalWrite\(/, `${name} must mark the record before queueing`);
    assert.match(b, /beginLocalWrite\(/, `${name} must mark the record while the write is in the air`);
  });

  test(`${name} goes through the write queue, not one write per keystroke`, () => {
    assert.match(body(name), /writes\.current\.enqueue\(/, `${name} must be debounced`);
  });
}

test('⚠️ the matter is suppressed as a whole record, not per field', () => {
  /*
   * A realtime event for `matter` carries the ENTIRE row. If suppression were
   * keyed per field, the echo of a save to Referral would still overwrite the
   * Insurance being typed. recordKey('matter', row) is `matter:<id>`, and the
   * writer must mark exactly that.
   */
  assert.match(body('updateMatterField'), /const key = `matter:\$\{matterId\}`/);
});

test('the suppression keys match what realtime.js computes', async () => {
  // If these drift, the guard marks one key and the echo arrives under another.
  const { recordKey } = await import('./realtime.js');
  assert.equal(recordKey('matter', { id: 'm1' }), 'matter:m1');
  assert.equal(recordKey('matter_checklist_item', { matter_id: 'm1', field_key: 'suitFiled' }),
    'matter_checklist_item:m1:suitFiled');
  assert.match(body('setChecklistItem'), /const key = `matter_checklist_item:\$\{matterId\}:\$\{fieldKey\}`/);
});
