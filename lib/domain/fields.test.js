import test from 'node:test';
import assert from 'node:assert/strict';
import { orphanedOption } from '@/lib/domain/fields';

/* ------------------------------------------------------------------ *
 * orphanedOption — a stored value outliving its option
 * ------------------------------------------------------------------ */

test('a value still in the options list needs no extra option', () => {
  const field = { options: ['Unknown', 'Parking', 'Postage'] };
  assert.equal(orphanedOption(field, 'Parking'), '');
  assert.equal(orphanedOption(field, 'Unknown'), '');
});

test('a value no longer offered is returned, so it can still render', () => {
  /*
   * THE REAL CASE THIS WAS WRITTEN FOR. The expense Type list was replaced
   * with Filevine's, which drops "Filing Fee", "Expert" and "Court Reporter".
   *
   * Without this a select renders BLANK for such a row, the DOM value becomes
   * '', and editing any other cell writes the emptiness back. The value does
   * not look lost until it already is.
   */
  const field = { options: ['Unknown', 'Court Filing Fee', 'Expert Report'] };
  assert.equal(orphanedOption(field, 'Court Reporter'), 'Court Reporter');
  assert.equal(orphanedOption(field, 'Filing Fee'), 'Filing Fee');
  assert.equal(orphanedOption(field, 'Expert'), 'Expert');
});

test('an empty value is not an orphan, it is just empty', () => {
  const field = { options: ['Unknown'] };
  for (const v of ['', '   ', null, undefined]) {
    assert.equal(orphanedOption(field, v), '', JSON.stringify(v));
  }
});

test('a field with no options does not crash', () => {
  // Reached by any select whose options are misconfigured or absent.
  assert.equal(orphanedOption({}, 'Something'), 'Something');
  assert.equal(orphanedOption(undefined, 'Something'), 'Something');
  assert.equal(orphanedOption(undefined, ''), '');
});

test('matching is exact — a near miss is still an orphan', () => {
  // "expert" must not be treated as "Expert Report". Silently coercing one
  // stored value into a different option would be worse than showing it as
  // retired: it would change what the row says without anyone asking.
  const field = { options: ['Expert Report'] };
  assert.equal(orphanedOption(field, 'expert report'), 'expert report');
  assert.equal(orphanedOption(field, 'Expert'), 'Expert');
  assert.equal(orphanedOption(field, 'Expert Report'), '');
});

test('surrounding whitespace does not create a phantom orphan', () => {
  // Spreadsheet imports carry padded cells; " Parking " is Parking.
  const field = { options: ['Parking'] };
  assert.equal(orphanedOption(field, '  Parking  '), '');
});
