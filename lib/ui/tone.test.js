import test from 'node:test';
import assert from 'node:assert/strict';
import { URGENCY_STYLE, urgencyBadgeClass } from '@/lib/ui/tone';
import { urgency } from '@/lib/domain/dates';

test('every level urgency() can return has a style', () => {
  /*
   * The point of this test. urgency() decides the levels; this module decides
   * their colours, and nothing in the type system connects the two. Adding a
   * sixth level to dates.js without a colour here would previously have
   * rendered an unstyled badge -- visible only if someone happened to look at
   * the right screen with the right data.
   *
   * Dates chosen to drive urgency() through all five branches, relative to a
   * fixed `today` so this cannot rot.
   */
  const today = '2026-06-15';
  const levels = new Set(
    ['2026-01-01', '2026-06-30', '2026-08-15', '2027-06-15', null, '', 'not a date']
      .map((d) => urgency(d, { today }).level),
  );

  assert.deepEqual(
    [...levels].sort(),
    ['critical', 'ok', 'overdue', 'unknown', 'warning'],
    'precondition: the fixtures should exercise all five levels',
  );

  for (const level of levels) {
    assert.ok(URGENCY_STYLE[level], `no style defined for urgency level "${level}"`);
  }
});

test('the badge carries both shape and colour', () => {
  const cls = urgencyBadgeClass('overdue');
  assert.match(cls, /rounded/, 'shape');
  assert.match(cls, /bg-danger-bg/, 'colour');
  assert.match(cls, /border-danger-line/);
});

test('an unrecognised level falls back to unknown, not to nothing', () => {
  // A badge with no colour classes reads as "fine". Missing information must
  // never look reassuring -- same rule urgency() follows for a missing date.
  assert.equal(urgencyBadgeClass('banana'), urgencyBadgeClass('unknown'));
  assert.equal(urgencyBadgeClass(undefined), urgencyBadgeClass('unknown'));
  assert.match(urgencyBadgeClass(undefined), /bg-raised/);
});

test('no style silently duplicates another', () => {
  // Two levels sharing a colour would make them indistinguishable on screen.
  const values = Object.values(URGENCY_STYLE);
  assert.equal(new Set(values).size, values.length);
});
