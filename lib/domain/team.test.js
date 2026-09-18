import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assigneeOptions, assignablePeople, foldName, UNASSIGNED,
} from '@/lib/domain/team';

/* ------------------------------------------------------------------ *
 * The roster
 * ------------------------------------------------------------------ */

test('the roster is the profile table plus you', () => {
  const options = assigneeOptions({
    people: ['Dana Ortiz', 'Bryan Bogran'],
    currentUser: { displayName: 'Paul Higdon' },
  });
  assert.deepEqual(options, ['Bryan Bogran', 'Dana Ortiz', 'Paul Higdon']);
});

test('history no longer pollutes everybody else’s dropdown', () => {
  /*
   * THE BUG THE FIRM REPORTED. Every `assignedTo` any task had ever carried
   * was merged into the list, and a set of strings cannot tell that six of
   * them are one attorney. Their dropdown held jbogran, John Paul, John Paul
   * Bográn Jr., John Paul Bográn, Jr, John Paul Bogran, Jr. and JP --
   * next to accounting, records, staff and test.
   *
   * Picking the wrong one does not fail. It assigns a statute of limitations
   * to a name nobody is watching.
   */
  const options = assigneeOptions({
    people: ['John Paul Bográn Jr.'],
    currentUser: { displayName: 'Rose Hassanzai' },
  });
  assert.deepEqual(options, ['John Paul Bográn Jr.', 'Rose Hassanzai']);
});

test('the signed-in user alone is still a usable roster', () => {
  // A fresh install, or local-storage mode. This is what made the dropdown
  // look broken rather than unpopulated.
  assert.deepEqual(assigneeOptions({ currentUser: { displayName: 'Paul Higdon' } }), ['Paul Higdon']);
});

test('"Unassigned" is never offered as a person', () => {
  const options = assigneeOptions({
    people: [UNASSIGNED, ''],
    current: 'unassigned',
  });
  assert.deepEqual(options, []);
});

test('no sources at all is an empty list, not a crash', () => {
  assert.deepEqual(assigneeOptions(), []);
  assert.deepEqual(assigneeOptions({}), []);
});

/* ------------------------------------------------------------------ *
 * Folding — the six spellings of one attorney
 * ------------------------------------------------------------------ */

test('accents, punctuation and case fold to one name', () => {
  assert.equal(foldName('John Paul Bográn, Jr.'), foldName('John Paul Bogran Jr'));
  assert.equal(foldName('J.P.'), foldName('JP'));
  assert.equal(foldName('  Dana Ortiz  '), foldName('dana ortiz'));
});

test('a handle is NOT folded onto a full name', () => {
  /*
   * `jbogran` and "John Paul Bogran" are the same human, and the letters do
   * not say so. Guessing from initials would eventually merge two real people
   * -- which on a task list means work silently handed to the wrong person.
   * Connecting those is the profile table's job, not a string's.
   */
  assert.notEqual(foldName('jbogran'), foldName('John Paul Bogran'));
});

test('variations of one person collapse to a single option', () => {
  const options = assigneeOptions({
    people: ['John Paul Bográn Jr.'],
    current: 'John Paul Bogran, Jr.',
  });
  assert.deepEqual(options, ['John Paul Bográn Jr.'], 'the same person appeared twice');
});

test('when spellings collide the profile wins, because somebody chose it', () => {
  const options = assigneeOptions({
    people: ['Rose Hassanzai'],
    current: 'rose hassanzai',
  });
  assert.deepEqual(options, ['Rose Hassanzai']);
});

/* ------------------------------------------------------------------ *
 * A task keeps its own assignee
 * ------------------------------------------------------------------ */

test('a task whose assignee has left still shows that name', () => {
  // Not merged into the global roster -- offered on THIS task only, so the
  // task renders and saves without silently dropping who it belongs to.
  const options = assigneeOptions({
    people: ['Dana Ortiz'],
    current: 'Former Paralegal',
  });
  assert.deepEqual(options, ['Dana Ortiz', 'Former Paralegal']);
});

test('that allowance does not leak to a task with no assignee', () => {
  assert.deepEqual(assigneeOptions({ people: ['Dana Ortiz'] }), ['Dana Ortiz']);
});

/* ------------------------------------------------------------------ *
 * Who counts as assignable
 * ------------------------------------------------------------------ */

test('shared mailboxes are logins, not people you hand a deadline to', () => {
  /*
   * `is_role_account` and `is_active` have been on the profile table since day
   * one and nothing read them -- the same write-only column fault that hid
   * linked contacts and Drive folder ids. accounting, records, scheduling,
   * receptionist, staff and test were all sitting in the dropdown.
   */
  const profiles = [
    { display_name: 'John Paul Bográn Jr.', is_role_account: false, is_active: true },
    { display_name: 'Rose Hassanzai', is_role_account: false, is_active: true },
    { display_name: 'accounting', is_role_account: true, is_active: true },
    { display_name: 'records', is_role_account: true, is_active: true },
    { display_name: 'Former Paralegal', is_role_account: false, is_active: false },
  ];
  assert.deepEqual(assignablePeople(profiles), ['John Paul Bográn Jr.', 'Rose Hassanzai']);
});

test('a profile with the flags absent is assumed to be a person', () => {
  // Rows written before these columns were read must not vanish from the
  // roster; the defaults in the schema say active and not a role account.
  assert.deepEqual(assignablePeople([{ display_name: 'Dana Ortiz' }]), ['Dana Ortiz']);
  assert.deepEqual(assignablePeople([{ display_name: '  ' }]), []);
  assert.deepEqual(assignablePeople(), []);
});
