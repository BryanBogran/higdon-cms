import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CASE_NUMBER_RE, formatCaseNumberInput, yearPrefix, usedCaseNumbers,
  nextCaseNumber, validateCaseNumber,
} from '@/lib/domain/case-number';

const m = (caseNumber, extra = {}) => ({ values: { caseNumber }, ...extra });

test('typing digits produces the hyphenated form', () => {
  assert.equal(formatCaseNumberInput('2'), '2');
  assert.equal(formatCaseNumberInput('26'), '26');
  assert.equal(formatCaseNumberInput('260'), '26-0');
  assert.equal(formatCaseNumberInput('26033'), '26-033');
});

test('pasting an already-formatted number is idempotent', () => {
  assert.equal(formatCaseNumberInput('26-033'), '26-033');
  assert.equal(formatCaseNumberInput(formatCaseNumberInput('26-033')), '26-033');
});

test('the separators people actually paste are absorbed', () => {
  // An en dash out of Word, a space, and a slash all mean the same thing to
  // the person typing. Rejecting them at submit time is not help.
  assert.equal(formatCaseNumberInput('26–033'), '26-033');
  assert.equal(formatCaseNumberInput('26 033'), '26-033');
  assert.equal(formatCaseNumberInput('26/033'), '26-033');
});

test('overtyping stops at five digits', () => {
  assert.equal(formatCaseNumberInput('2603399'), '26-033');
});

test('empty stays empty rather than becoming a stray hyphen', () => {
  assert.equal(formatCaseNumberInput(''), '');
  assert.equal(formatCaseNumberInput(null), '');
  assert.equal(formatCaseNumberInput('abc'), '');
});

test('the regex matches the database check constraint', () => {
  assert.ok(CASE_NUMBER_RE.test('26-033'));
  assert.ok(!CASE_NUMBER_RE.test('26-33'));
  assert.ok(!CASE_NUMBER_RE.test('2026-033'));
  assert.ok(!CASE_NUMBER_RE.test('26-0333'));
  assert.ok(!CASE_NUMBER_RE.test(' 26-033'));
});

test('yearPrefix reads the two-digit year off an ISO date', () => {
  assert.equal(yearPrefix('2026-08-31'), '26');
  assert.equal(yearPrefix(''), '');
});

test('used numbers skip archived and deleted matters', () => {
  const used = usedCaseNumbers({
    a: m('26-001'),
    b: m('26-002', { archivedAt: '2026-01-01' }),
    c: m('26-003', { deletedAt: '2026-01-01' }),
    d: m(''),
  });
  assert.deepEqual([...used].sort(), ['26-001']);
});

test('nextCaseNumber follows the highest number of that year', () => {
  const matters = { a: m('26-001'), b: m('26-028'), c: m('25-400') };
  assert.equal(nextCaseNumber(matters, '26'), '26-029');
  assert.equal(nextCaseNumber(matters, '25'), '25-401');
  assert.equal(nextCaseNumber(matters, '27'), '27-001');
});

test('nextCaseNumber refuses to wrap past 999', () => {
  assert.equal(nextCaseNumber({ a: m('26-999') }, '26'), null);
});

test('a well-formed, unused, current-year number is clean', () => {
  assert.deepEqual(validateCaseNumber('26-033', { matters: {}, currentYear: '26' }), {});
});

test('a malformed number is an error', () => {
  assert.match(validateCaseNumber('26-33').error, /two digits/);
  assert.match(validateCaseNumber('').error, /automatically/);
});

test('a number already in use is an error', () => {
  const r = validateCaseNumber('26-001', { matters: { a: m('26-001') } });
  assert.match(r.error, /already used/);
});

test('a number freed by archiving is not treated as in use', () => {
  // The unique index is partial -- `where deleted_at is null` -- so a number
  // on a removed matter really is available, and refusing it here would
  // disagree with the database.
  assert.deepEqual(
    validateCaseNumber('26-001', { matters: { a: m('26-001', { deletedAt: 'x' }) }, currentYear: '26' }),
    {},
  );
});

test('an older year warns but does not block', () => {
  const r = validateCaseNumber('25-033', { currentYear: '26' });
  assert.equal(r.error, undefined);
  assert.match(r.warning, /not a 26 number/);
});
