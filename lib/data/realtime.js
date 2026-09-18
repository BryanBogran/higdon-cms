/**
 * Live sync: other people's changes, applied as they land.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * The app loaded everything once and never looked again. Two consequences,
 * both of which the firm reported on 2026-09-18:
 *
 *   "things that I've entered, Mireya is unable to see on her HigVine"
 *
 * and, before supabase/017 fixed the writes themselves, a tab left open all
 * morning would actively revert the case to its 9am copy the moment its owner
 * saved anything.
 *
 * 017 stopped stale copies DESTROYING other people's work. This is the other
 * half: stale copies stop existing.
 *
 * ── A pure reducer, deliberately ─────────────────────────────────────────
 *
 * `applyChange` takes state and an event and returns the slices that changed.
 * No Supabase client, no React, no subscription. That is what makes it
 * testable -- a realtime bug that can only be reproduced by two people typing
 * at once is a bug nobody can reproduce.
 *
 * The subscription mechanics live in DataProvider; everything that decides
 * WHAT CHANGES lives here.
 *
 * ⚠️ THE SHAPES MUST MATCH `loadAll` EXACTLY. Every branch below builds state
 * the same way the initial load does, using the same exported mappers. If the
 * two ever disagree, a record will look different depending on whether you
 * loaded the page before or after it changed -- which is worse than no live
 * sync at all, because it is intermittent.
 */

import {
  rowsToMatters, activityRowToEntry, taskRowToTask, contactRowToContact,
} from './supabase-store';
import { DOC_FIELDS } from '@/lib/domain/fields';

/** The tables worth watching. Each must be in the realtime publication -- see supabase/018. */
export const REALTIME_TABLES = [
  'matter',
  'matter_checklist_item',
  'activity',
  'matter_section_data',
  'matter_section_row',
  'contact',
];

/**
 * A stable identity for one record, used to recognise the echo of our own
 * write. See `markLocalWrite` in DataProvider.
 *
 * Built from the PRIMARY KEY only, because a DELETE event carries nothing
 * else: Postgres sends just the key columns unless the table is set to
 * `replica identity full`, which we deliberately do not do (it writes every
 * old row into the WAL for the sake of a field we never read).
 */
export function recordKey(table, row) {
  if (!row) return null;
  switch (table) {
    case 'matter':
    case 'activity':
    case 'contact':
      return row.id ? `${table}:${row.id}` : null;
    case 'matter_section_row':
      return row.id ? `${table}:${row.id}` : null;
    case 'matter_section_data':
      return row.matter_id ? `${table}:${row.matter_id}:${row.section_key}` : null;
    case 'matter_checklist_item':
      return row.matter_id ? `${table}:${row.matter_id}:${row.field_key}` : null;
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ *
 * Small immutable helpers
 * ------------------------------------------------------------------ */

function withSection(sections, matterId, sectionKey, updater) {
  const forMatter = sections[matterId] || {};
  const current = forMatter[sectionKey] || { fields: {}, rows: [] };
  return { ...sections, [matterId]: { ...forMatter, [sectionKey]: updater(current) } };
}

function without(map, id) {
  if (!(id in map)) return null;
  const next = { ...map };
  delete next[id];
  return next;
}

/**
 * Remove a section row by id alone.
 *
 * A DELETE gives us the primary key and nothing else -- no matter_id, no
 * section_key -- so the row has to be found. The scan is over data already in
 * memory and runs once per deletion, which is a cheaper price than making
 * every UPDATE on the table write its old row to the WAL.
 */
function removeSectionRowById(sections, rowId) {
  for (const [matterId, forMatter] of Object.entries(sections)) {
    for (const [sectionKey, section] of Object.entries(forMatter || {})) {
      if (!(section?.rows || []).some((r) => r.id === rowId)) continue;
      return withSection(sections, matterId, sectionKey, (s) => ({
        ...s,
        rows: s.rows.filter((r) => r.id !== rowId),
      }));
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * The reducer
 * ------------------------------------------------------------------ */

/**
 * @param {object} state   { matters, tasks, activity, sections, contacts }
 * @param {object} event   { table, type: 'INSERT'|'UPDATE'|'DELETE', row, old }
 * @returns {object|null}  only the slices that changed, or null for a no-op
 */
export function applyChange(state, event) {
  const { table, type } = event || {};
  const row = event?.row;
  const old = event?.old;
  if (!table) return null;

  const matters = state?.matters || {};
  const tasks = state?.tasks || {};
  const activity = state?.activity || {};
  const sections = state?.sections || {};
  const contacts = state?.contacts || {};

  switch (table) {
    /* -------------------------------------------------------------- */
    case 'matter_section_row': {
      if (type === 'DELETE') {
        const next = removeSectionRowById(sections, old?.id);
        return next ? { sections: next } : null;
      }
      if (!row?.id || !row.matter_id) return null;
      // The row's identity is the column, never the payload -- same rule the
      // update function enforces in SQL.
      const mapped = { id: row.id, ...(row.data || {}) };
      delete mapped.id;
      mapped.id = row.id;
      return {
        sections: withSection(sections, row.matter_id, row.section_key, (s) => {
          const i = s.rows.findIndex((r) => r.id === row.id);
          // Appended when new: rows are ordered by `ordinal` and a new row
          // takes the highest one, so the end is where it belongs.
          const rows = i === -1 ? [...s.rows, mapped] : s.rows.map((r, k) => (k === i ? mapped : r));
          return { ...s, rows };
        }),
      };
    }

    /* -------------------------------------------------------------- */
    case 'matter_section_data': {
      const key = type === 'DELETE' ? old : row;
      if (!key?.matter_id) return null;
      if (type === 'DELETE') {
        const forMatter = sections[key.matter_id];
        if (!forMatter?.[key.section_key]) return null;
        return {
          sections: withSection(sections, key.matter_id, key.section_key, (s) => ({ ...s, fields: {} })),
        };
      }
      return {
        sections: withSection(sections, row.matter_id, row.section_key, (s) => ({
          ...s,
          fields: row.fields || {},
        })),
      };
    }

    /* -------------------------------------------------------------- */
    case 'activity': {
      if (type === 'DELETE') {
        const id = old?.id;
        if (!id) return null;
        const nextActivity = without(activity, id);
        const nextTasks = without(tasks, id);
        if (!nextActivity && !nextTasks) return null;
        return {
          ...(nextActivity ? { activity: nextActivity } : {}),
          ...(nextTasks ? { tasks: nextTasks } : {}),
        };
      }
      if (!row?.id) return null;
      const patch = { activity: { ...activity, [row.id]: activityRowToEntry(row) } };
      // One table, two views over it -- the feed shows everything, the Tasks
      // page shows the rows whose kind is 'task'. loadAll does the same.
      if (row.kind === 'task') patch.tasks = { ...tasks, [row.id]: taskRowToTask(row) };
      return patch;
    }

    /* -------------------------------------------------------------- */
    case 'matter': {
      if (type === 'DELETE') {
        const next = without(matters, old?.id);
        return next ? { matters: next } : null;
      }
      if (!row?.id) return null;
      const mapped = rowsToMatters([row], [])[row.id];
      if (!mapped) return null;
      /*
       * Checklist state lives in its own table and arrives in its own events.
       * `rowsToMatters` with no checklist rows fills those keys with empty
       * values, so carry the ones we already hold -- otherwise every edit to
       * a case would blank its checklist until the page was reloaded.
       */
      const prev = matters[row.id];
      if (prev?.values) {
        for (const key of DOC_FIELDS) {
          if (key in prev.values) mapped.values[key] = prev.values[key];
        }
      }
      return { matters: { ...matters, [row.id]: mapped } };
    }

    /* -------------------------------------------------------------- */
    case 'matter_checklist_item': {
      const key = type === 'DELETE' ? old : row;
      const matter = key?.matter_id ? matters[key.matter_id] : null;
      // Unknown case: nothing on screen to update, and inventing one would put
      // a matter in the list that the loader never returned.
      if (!matter) return null;
      // Mirrors rowsToMatters: only the yes/no+document fields live in values.
      if (!DOC_FIELDS.has(key.field_key)) return null;

      const item = type === 'DELETE'
        ? { done: false, date: '', docUrl: '', note: '' }
        : {
            done: Boolean(row.done),
            date: row.occurred_on || '',
            docUrl: row.doc_url || '',
            note: row.note || '',
          };

      return {
        matters: {
          ...matters,
          [key.matter_id]: { ...matter, values: { ...matter.values, [key.field_key]: item } },
        },
      };
    }

    /* -------------------------------------------------------------- */
    case 'contact': {
      if (type === 'DELETE') {
        const next = without(contacts, old?.id);
        return next ? { contacts: next } : null;
      }
      if (!row?.id) return null;
      // Contacts are soft-deleted, and loadAll filters those out. A row that
      // has just been deleted arrives as an UPDATE, not a DELETE.
      if (row.deleted_at) {
        const next = without(contacts, row.id);
        return next ? { contacts: next } : null;
      }
      return { contacts: { ...contacts, [row.id]: contactRowToContact(row) } };
    }

    default:
      return null;
  }
}
