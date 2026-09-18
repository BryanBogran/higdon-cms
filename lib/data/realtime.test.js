import test from 'node:test';
import assert from 'node:assert/strict';
import { applyChange, recordKey, REALTIME_TABLES } from '@/lib/data/realtime';
import { createSupabaseStore } from '@/lib/data/supabase-store';
import { fakeSupabase } from '@/lib/data/fake-supabase';

const empty = { matters: {}, tasks: {}, activity: {}, sections: {}, contacts: {} };

/* ------------------------------------------------------------------ *
 * Section rows — the repeating tables the firm was losing data in
 * ------------------------------------------------------------------ */

test('a row someone else added appears', () => {
  const patch = applyChange(empty, {
    table: 'matter_section_row',
    type: 'INSERT',
    row: { id: 'r1', matter_id: 'm1', section_key: 'expenses', data: { type: 'Parking', amount: '40' } },
  });
  assert.deepEqual(patch.sections.m1.expenses.rows, [{ id: 'r1', type: 'Parking', amount: '40' }]);
});

test('an edit replaces the row in place rather than duplicating it', () => {
  const state = {
    ...empty,
    sections: { m1: { expenses: { fields: {}, rows: [{ id: 'r1', type: 'Parking' }] } } },
  };
  const patch = applyChange(state, {
    table: 'matter_section_row',
    type: 'UPDATE',
    row: { id: 'r1', matter_id: 'm1', section_key: 'expenses', data: { type: 'Parking', amount: '40' } },
  });
  assert.equal(patch.sections.m1.expenses.rows.length, 1);
  assert.deepEqual(patch.sections.m1.expenses.rows[0], { id: 'r1', type: 'Parking', amount: '40' });
});

test('a deleted row goes, found by id alone', () => {
  /*
   * THE AWKWARD ONE. A DELETE carries only the primary key -- no matter_id,
   * no section_key -- so the row has to be located by id across every section
   * held in memory. If this ever regresses, a row deleted by one person stays
   * on everybody else's screen until they reload.
   */
  const state = {
    ...empty,
    sections: {
      m1: { expenses: { fields: {}, rows: [{ id: 'r1' }, { id: 'r2' }] } },
      m2: { medicals: { fields: {}, rows: [{ id: 'r3' }] } },
    },
  };
  const patch = applyChange(state, { table: 'matter_section_row', type: 'DELETE', old: { id: 'r2' } });
  assert.deepEqual(patch.sections.m1.expenses.rows, [{ id: 'r1' }]);
  assert.deepEqual(patch.sections.m2.medicals.rows, [{ id: 'r3' }], 'another case was touched');
});

test('deleting a row we never had is a no-op, not a crash', () => {
  assert.equal(applyChange(empty, { table: 'matter_section_row', type: 'DELETE', old: { id: 'nope' } }), null);
});

test("a row's id cannot be rewritten by its payload", () => {
  const patch = applyChange(empty, {
    table: 'matter_section_row',
    type: 'INSERT',
    row: { id: 'r1', matter_id: 'm1', section_key: 'expenses', data: { id: 'r999', type: 'Parking' } },
  });
  assert.equal(patch.sections.m1.expenses.rows[0].id, 'r1');
});

/* ------------------------------------------------------------------ *
 * Section fields
 * ------------------------------------------------------------------ */

test("a field someone else saved shows up without a refresh", () => {
  // Literally the firm's complaint: "things that I've entered, Mireya is
  // unable to see on her HigVine".
  const state = {
    ...empty,
    sections: { m1: { medicals: { fields: { provider: 'Dr Ruiz' }, rows: [] } } },
  };
  const patch = applyChange(state, {
    table: 'matter_section_data',
    type: 'UPDATE',
    row: { matter_id: 'm1', section_key: 'medicals', fields: { provider: 'Dr Ruiz', status: 'Ongoing' } },
  });
  assert.deepEqual(patch.sections.m1.medicals.fields, { provider: 'Dr Ruiz', status: 'Ongoing' });
});

test('a section arriving for a case with no section state yet is created', () => {
  const patch = applyChange(empty, {
    table: 'matter_section_data',
    type: 'INSERT',
    row: { matter_id: 'm9', section_key: 'intake', fields: { a: '1' } },
  });
  assert.deepEqual(patch.sections.m9.intake, { fields: { a: '1' }, rows: [] });
});

/* ------------------------------------------------------------------ *
 * Activity — one table, two views
 * ------------------------------------------------------------------ */

test('a task lands in BOTH the feed and the task list', () => {
  const patch = applyChange(empty, {
    table: 'activity',
    type: 'INSERT',
    row: { id: 'a1', matter_id: 'm1', kind: 'task', body: 'Call adjuster', source: 'ui' },
  });
  assert.ok(patch.activity.a1, 'missing from the feed');
  assert.ok(patch.tasks.a1, 'missing from the task list');
});

test('a note lands in the feed only', () => {
  const patch = applyChange(empty, {
    table: 'activity',
    type: 'INSERT',
    row: { id: 'a2', matter_id: 'm1', kind: 'note', body: 'Spoke to client', source: 'ui' },
  });
  assert.ok(patch.activity.a2);
  assert.equal(patch.tasks, undefined);
});

test('a deleted entry leaves both views', () => {
  const state = { ...empty, activity: { a1: { id: 'a1' } }, tasks: { a1: { id: 'a1' } } };
  const patch = applyChange(state, { table: 'activity', type: 'DELETE', old: { id: 'a1' } });
  assert.deepEqual(patch.activity, {});
  assert.deepEqual(patch.tasks, {});
});

/* ------------------------------------------------------------------ *
 * Matters and checklists — two tables, one object
 * ------------------------------------------------------------------ */

test('editing a case does not blank its checklist', () => {
  /*
   * THE TRAP. Checklist state lives in matter_checklist_item and arrives in
   * its own events, so mapping a bare `matter` row fills those keys with
   * empty values. Applied naively, every edit to a case would wipe its
   * checklist on everyone else's screen until they reloaded -- which is the
   * exact class of bug live sync is meant to end.
   */
  const store = createSupabaseStore(fakeSupabase({}));
  const before = {
    ...empty,
    matters: {
      m1: {
        values: { clientName: 'Garcia', suitFiled: { done: true, date: '2026-03-01', docUrl: '', note: '' } },
      },
    },
  };
  const patch = applyChange(before, {
    table: 'matter',
    type: 'UPDATE',
    row: { id: 'm1', client_name: 'Garcia, Ana', created_at: 'x', last_activity_at: 'y' },
  });
  assert.deepEqual(
    patch.matters.m1.values.suitFiled,
    { done: true, date: '2026-03-01', docUrl: '', note: '' },
    'the checklist was blanked'
  );
  assert.equal(patch.matters.m1.values.clientName, 'Garcia, Ana', 'the edit did not apply');
  assert.ok(store);
});

test('a ticked checklist box shows up on the other screen', () => {
  const state = { ...empty, matters: { m1: { values: { clientName: 'Garcia' } } } };
  const patch = applyChange(state, {
    table: 'matter_checklist_item',
    type: 'UPDATE',
    row: { matter_id: 'm1', field_key: 'suitFiled', done: true, occurred_on: '2026-03-01' },
  });
  assert.deepEqual(patch.matters.m1.values.suitFiled, {
    done: true, date: '2026-03-01', docUrl: '', note: '',
  });
});

test('a checklist item for a case we do not hold is ignored', () => {
  // Inventing the case would put a matter in the list that the loader never
  // returned -- a row in the case list with no name and no number.
  assert.equal(
    applyChange(empty, {
      table: 'matter_checklist_item',
      type: 'UPDATE',
      row: { matter_id: 'unknown', field_key: 'suitFiled', done: true },
    }),
    null
  );
});

/* ------------------------------------------------------------------ *
 * Contacts
 * ------------------------------------------------------------------ */

test('a soft-deleted contact disappears, though it arrives as an UPDATE', () => {
  const state = { ...empty, contacts: { c1: { id: 'c1', name: 'Dr Ruiz' } } };
  const patch = applyChange(state, {
    table: 'contact',
    type: 'UPDATE',
    row: { id: 'c1', deleted_at: '2026-09-18T00:00:00Z' },
  });
  assert.deepEqual(patch.contacts, {});
});

/* ------------------------------------------------------------------ *
 * The invariant that matters most
 * ------------------------------------------------------------------ */

test('a record applied live matches the same record loaded fresh', async () => {
  /*
   * THE WHOLE POINT. If live sync builds state even slightly differently from
   * loadAll, a record looks different depending on whether you opened the page
   * before or after it changed. That is worse than no live sync, because it is
   * intermittent and nobody can reproduce it.
   */
  const rows = {
    matter: [{ id: 'm1', client_name: 'Garcia, Ana', case_number: '26-001' }],
    matter_checklist_item: [],
    activity: [{ id: 'a1', matter_id: 'm1', kind: 'task', body: 'Call adjuster', source: 'ui' }],
    matter_section_data: [{ matter_id: 'm1', section_key: 'medicals', fields: { provider: 'Dr Ruiz' } }],
    matter_section_row: [{ id: 'r1', matter_id: 'm1', section_key: 'expenses', ordinal: 0, data: { type: 'Parking' } }],
    contact: [{ id: 'c1', full_name: 'Dr Ruiz' }],
    profile: [],
    matter_relation: [],
  };
  const loaded = await createSupabaseStore(fakeSupabase(rows)).loadAll();

  // Now build the same state from an empty page, one event at a time.
  let live = { ...empty };
  const events = [
    { table: 'matter', type: 'INSERT', row: rows.matter[0] },
    { table: 'activity', type: 'INSERT', row: rows.activity[0] },
    { table: 'matter_section_data', type: 'INSERT', row: rows.matter_section_data[0] },
    { table: 'matter_section_row', type: 'INSERT', row: rows.matter_section_row[0] },
    { table: 'contact', type: 'INSERT', row: rows.contact[0] },
  ];
  for (const e of events) live = { ...live, ...applyChange(live, e) };

  assert.deepEqual(live.matters, loaded.matters, 'matters differ');
  assert.deepEqual(live.tasks, loaded.tasks, 'tasks differ');
  assert.deepEqual(live.activity, loaded.activity, 'activity differ');
  assert.deepEqual(live.sections, loaded.sections, 'sections differ');
  assert.deepEqual(live.contacts, loaded.contacts, 'contacts differ');
});

/* ------------------------------------------------------------------ *
 * Identity, used to recognise the echo of our own write
 * ------------------------------------------------------------------ */

test('recordKey is built from the primary key, so a DELETE can be matched', () => {
  // A DELETE carries only the key columns, so anything else would be absent
  // exactly when it is needed.
  assert.equal(recordKey('matter_section_row', { id: 'r1' }), 'matter_section_row:r1');
  assert.equal(
    recordKey('matter_section_data', { matter_id: 'm1', section_key: 'medicals' }),
    'matter_section_data:m1:medicals'
  );
  assert.equal(
    recordKey('matter_checklist_item', { matter_id: 'm1', field_key: 'suitFiled' }),
    'matter_checklist_item:m1:suitFiled'
  );
  assert.equal(recordKey('matter', { id: 'm1' }), 'matter:m1');
  assert.equal(recordKey('nonsense', { id: 'x' }), null);
  assert.equal(recordKey('matter', null), null);
});

test('an unknown table changes nothing', () => {
  assert.equal(applyChange(empty, { table: 'audit_event', type: 'INSERT', row: { id: 'x' } }), null);
  assert.equal(applyChange(empty, {}), null);
});

test('every watched table has a branch', () => {
  // A table added to the publication but not handled here would stream events
  // that are silently dropped -- live sync that looks on and does nothing.
  for (const table of REALTIME_TABLES) {
    const handled = applyChange(empty, {
      table,
      type: 'INSERT',
      row: { id: 'x', matter_id: 'm1', section_key: 's', field_key: 'suitFiled', kind: 'note' },
    });
    assert.notEqual(handled, undefined, `${table} has no branch`);
  }
});

/* ------------------------------------------------------------------ *
 * Replies — an activity row that must never reach the feed
 * ------------------------------------------------------------------ */

test("a reply arriving live goes to its thread, not the feed", () => {
  /*
   * ⚠️ THE LEAK THIS PREVENTS. A reply IS an `activity` row. loadAll
   * partitions them out so the feed page and a matter's Activity tab never
   * have to know replies exist -- and without this branch, a reply arriving
   * over live sync would walk straight past that and render as a post of its
   * own. Same rule, both entry points.
   */
  const state = { ...empty, activity: { a1: { id: 'a1', kind: 'task' } } };
  const patch = applyChange(state, {
    table: 'activity',
    type: 'INSERT',
    row: { id: 'r1', parent_id: 'a1', matter_id: 'm1', kind: 'note', body: 'Records still outstanding', source: 'ui' },
  });
  assert.equal(patch.activity, undefined, 'a reply was put in the feed');
  assert.equal(patch.replies.a1.length, 1);
  assert.equal(patch.replies.a1[0].body, 'Records still outstanding');
});

test('a thread reads oldest first', () => {
  // Unlike the feed, which is newest first because it is a list of what just
  // happened rather than a conversation.
  const state = {
    ...empty,
    replies: { a1: [{ id: 'r2', body: 'second', createdAt: '2026-09-18T10:00:00Z' }] },
  };
  const patch = applyChange(state, {
    table: 'activity',
    type: 'INSERT',
    row: { id: 'r1', parent_id: 'a1', kind: 'note', body: 'first', created_at: '2026-09-18T09:00:00Z' },
  });
  assert.deepEqual(patch.replies.a1.map((r) => r.body), ['first', 'second']);
});

test('a deleted reply leaves its thread and not the feed', () => {
  const state = {
    ...empty,
    activity: { a1: { id: 'a1' } },
    replies: { a1: [{ id: 'r1' }, { id: 'r2' }] },
  };
  const patch = applyChange(state, { table: 'activity', type: 'DELETE', old: { id: 'r1' } });
  assert.deepEqual(patch.replies.a1.map((r) => r.id), ['r2']);
  assert.equal(patch.activity, undefined, 'the parent was touched');
});

test('an edited reply replaces in place rather than duplicating', () => {
  const state = { ...empty, replies: { a1: [{ id: 'r1', body: 'typo', createdAt: '2026-09-18T09:00:00Z' }] } };
  const patch = applyChange(state, {
    table: 'activity',
    type: 'UPDATE',
    row: { id: 'r1', parent_id: 'a1', kind: 'note', body: 'fixed', created_at: '2026-09-18T09:00:00Z' },
  });
  assert.equal(patch.replies.a1.length, 1);
  assert.equal(patch.replies.a1[0].body, 'fixed');
});
