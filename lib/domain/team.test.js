import test from 'node:test';
import assert from 'node:assert/strict';
import { assigneeOptions, UNASSIGNED } from '@/lib/domain/team';

test('merges the profile table, the signed-in user and task history', () => {
  const options = assigneeOptions({
    team: { 'Dana Ortiz': 'dana@x.com', 'Bryan Bogran': 'bryan@x.com' },
    currentUser: { displayName: 'Paul Higdon' },
    activity: {
      a1: { assignedTo: 'Renata Vela' },
      a2: { assignedTo: 'Dana Ortiz' },
    },
  });
  assert.deepEqual(options, ['Bryan Bogran', 'Dana Ortiz', 'Paul Higdon', 'Renata Vela']);
});

test('the signed-in user alone is still a usable roster', () => {
  // The empty-team case: a fresh install, or local-storage mode. This is what
  // made the dropdown look broken.
  assert.deepEqual(assigneeOptions({ currentUser: { displayName: 'Paul Higdon' } }), ['Paul Higdon']);
});

test('"Unassigned" is never offered as a person', () => {
  const options = assigneeOptions({
    team: { [UNASSIGNED]: '' },
    activity: { a1: { assignedTo: 'unassigned' }, a2: { assignedTo: '' }, a3: {} },
  });
  assert.deepEqual(options, []);
});

test('a name only history knows survives, so its tasks can be reassigned back', () => {
  const options = assigneeOptions({
    team: { 'Dana Ortiz': 'dana@x.com' },
    activity: { a1: { assignedTo: 'Former Paralegal' } },
  });
  assert.ok(options.includes('Former Paralegal'));
});

test('no sources at all is an empty list, not a crash', () => {
  assert.deepEqual(assigneeOptions(), []);
  assert.deepEqual(assigneeOptions({}), []);
});

test('whitespace and duplicates collapse', () => {
  const options = assigneeOptions({
    team: { 'Dana Ortiz': '' },
    activity: { a1: { assignedTo: '  Dana Ortiz  ' }, a2: { assignedTo: '   ' } },
  });
  assert.deepEqual(options, ['Dana Ortiz']);
});
