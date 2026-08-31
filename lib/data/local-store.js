/**
 * localStorage implementation of the data layer.
 *
 * Same twenty-one intents as the Supabase store, so `DataProvider` can pick
 * either at runtime. This one exists so the app still runs before the Supabase
 * project is configured — useful for local work and for verifying UI changes
 * without a network round-trip.
 *
 * Not a long-term fallback: it is single-device, single-user, and has no audit
 * trail. Once Supabase is live this is development scaffolding.
 */

import { emptyValues, emptyDocValue, DOC_FIELDS } from '@/lib/domain/fields';
import { generateChainTasks } from '@/lib/domain/chain';
import { todayInFirmTz } from '@/lib/domain/dates';
import {
  CASE_NUMBER_RE, nextCaseNumber, usedCaseNumbers, yearPrefix,
} from '@/lib/domain/case-number';

const KEYS = {
  matters: 'case-records',
  tasks: 'firm-tasks',
  team: 'team-directory',
  sections: 'matter-sections',
  activity: 'matter-activity',
  relations: 'matter-relations',
  contacts: 'firm-contacts',
};

const uuid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

function read(key, fallback) {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  if (typeof window === 'undefined') return { ok: true };
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return { ok: true };
  } catch (err) {
    // Surfaced, never swallowed. The prototype had .catch(() => {}) here, so a
    // failed save on a legal file was invisible.
    return { ok: false, error: err?.message || 'Save failed' };
  }
}

export function createLocalStore() {
  /** Recompute the chain from current storage and persist it. */
  function regenerate() {
    const matters = read(KEYS.matters, {});
    const tasks = read(KEYS.tasks, {});
    const next = generateChainTasks(matters, tasks);
    return write(KEYS.tasks, next);
  }

  function patchMatter(matterId, mutate) {
    const matters = read(KEYS.matters, {});
    const current = matters[matterId];
    if (!current) return { ok: false, error: 'No such matter' };
    matters[matterId] = { ...mutate(current), lastActivityAt: new Date().toISOString() };
    const r = write(KEYS.matters, matters);
    if (!r.ok) return r;
    return regenerate();
  }

  return {
    async loadAll() {
      const matters = read(KEYS.matters, {});
      const tasks = generateChainTasks(matters, read(KEYS.tasks, {}));
      write(KEYS.tasks, tasks);
      return {
        matters,
        tasks,
        activity: read(KEYS.activity, {}),
        sections: read(KEYS.sections, {}),
        team: read(KEYS.team, {}),
        relations: read(KEYS.relations, []),
        contacts: read(KEYS.contacts, {}),
      };
    },

    async createMatter(input = {}) {
      const id = uuid();
      const values = { ...emptyValues(), ...input };
      if (!values.openDate) values.openDate = todayInFirmTz();
      const matters = read(KEYS.matters, {});

      /*
       * Case numbers, matching the Supabase store's contract.
       *
       * This store used to leave `caseNumber` blank whenever the caller did
       * not supply one, so every case created in local mode had no number --
       * the two backends disagreed about the one field the firm uses to name a
       * file. Now both allocate.
       *
       * There is no atomic counter here and there does not need to be: this is
       * one browser's localStorage, so "highest in use, plus one" cannot race
       * with anybody.
       */
      const typed = String(values.caseNumber || '').trim();
      if (typed) {
        if (!CASE_NUMBER_RE.test(typed)) {
          return { ok: false, error: 'A case number is two digits, a hyphen, then three — 26-033.' };
        }
        if (usedCaseNumbers(matters).has(typed)) {
          return { ok: false, error: `${typed} is already used by another case.` };
        }
        values.caseNumber = typed;
      } else {
        values.caseNumber = nextCaseNumber(matters, yearPrefix(values.openDate)) || '';
      }

      matters[id] = {
        values,
        createdAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
      };
      const r = write(KEYS.matters, matters);
      if (!r.ok) return { ok: false, error: r.error };
      regenerate();
      return { ok: true, id, caseNumber: values.caseNumber || '' };
    },

    /**
     * Write a reviewed import plan. Mirrors the Supabase store's contract:
     * only keys present in a row are written, so a partial spreadsheet cannot
     * blank a field it never mentioned.
     */
    async importMatters(entries = []) {
      const matters = read(KEYS.matters, {});
      const created = [];
      const updated = [];
      const failed = [];
      const stamp = new Date().toISOString();

      const applyChecklist = (values, checklist) => {
        for (const [key, item] of Object.entries(checklist || {})) {
          if (!DOC_FIELDS.has(key)) continue;
          values[key] = { ...emptyDocValue(), ...(values[key] || {}), ...item };
        }
      };

      for (const entry of entries) {
        if (entry.action === 'create') {
          const id = uuid();
          const values = { ...emptyValues(), ...entry.values };
          if (!values.status) values.status = 'Open';
          applyChecklist(values, entry.checklist);
          matters[id] = { values, createdAt: stamp, lastActivityAt: stamp };
          created.push(id);
        } else if (entry.action === 'update') {
          const current = matters[entry.matterId];
          if (!current) { failed.push({ rowIndex: entry.rowIndex, error: 'No such matter' }); continue; }
          const values = { ...current.values, ...entry.values };
          applyChecklist(values, entry.checklist);
          matters[entry.matterId] = { ...current, values, lastActivityAt: stamp };
          updated.push(entry.matterId);
        }
      }

      const r = write(KEYS.matters, matters);
      if (!r.ok) return { ok: false, created: 0, updated: 0, failed: [{ rowIndex: null, error: r.error }] };
      regenerate();
      return { ok: failed.length === 0, created: created.length, updated: updated.length, failed };
    },

    /* -------- contacts -------- */

    async createContact(contact = {}) {
      const id = uuid();
      const all = read(KEYS.contacts, {});
      const stamp = new Date().toISOString();
      all[id] = { ...contact, id, createdAt: stamp, updatedAt: stamp };
      const r = write(KEYS.contacts, all);
      return r.ok ? { ok: true, id, contact: all[id] } : { ok: false, error: r.error };
    },

    async updateContact(id, patch = {}) {
      const all = read(KEYS.contacts, {});
      if (!all[id]) return { ok: false, error: 'No such contact' };
      all[id] = { ...all[id], ...patch, id, updatedAt: new Date().toISOString() };
      const r = write(KEYS.contacts, all);
      return r.ok ? { ok: true, contact: all[id] } : { ok: false, error: r.error };
    },

    async linkClientContact(matterId, contactId, displayName) {
      return patchMatter(matterId, (m) => ({
        ...m,
        clientContactId: contactId || '',
        values: { ...m.values, ...(displayName ? { clientName: displayName } : {}) },
      }));
    },

    async updateMatterField(matterId, fieldKey, value) {
      return patchMatter(matterId, (m) => ({ ...m, values: { ...m.values, [fieldKey]: value } }));
    },

    async setChecklistItem(matterId, fieldKey, patch) {
      if (!DOC_FIELDS.has(fieldKey)) return { ok: false, error: `${fieldKey} is not a checklist item` };
      return patchMatter(matterId, (m) => ({
        ...m,
        values: {
          ...m.values,
          [fieldKey]: { ...(m.values[fieldKey] || emptyDocValue()), ...patch },
        },
      }));
    },

    async archiveMatter(matterId) {
      return patchMatter(matterId, (m) => ({ ...m, archivedAt: new Date().toISOString() }));
    },

    async unarchiveMatter(matterId) {
      return patchMatter(matterId, ({ archivedAt, ...rest }) => rest);
    },

    /**
     * Permanent deletion, mirroring the Supabase store's contract.
     *
     * Postgres has ON DELETE CASCADE; localStorage has seven independent
     * keys and no referential integrity at all, so every one that can hold
     * something belonging to a matter is swept by hand. Missing one leaves
     * activity and section rows pointing at a case that no longer exists —
     * which is exactly the orphan the cascade exists to prevent, and which
     * would then show up in the global Feed attached to nothing.
     */
    async deleteMatter(matterId) {
      const matters = read(KEYS.matters, {});
      const matter = matters[matterId];
      if (!matter) return { ok: false, error: 'No such matter' };

      const caseNumber = matter.values?.caseNumber || '';
      const removed = { activity: 0, tasks: 0, sectionRows: 0, relations: 0 };

      delete matters[matterId];
      const w1 = write(KEYS.matters, matters);
      if (!w1.ok) return { ok: false, error: w1.error };

      const activity = read(KEYS.activity, {});
      for (const [id, e] of Object.entries(activity)) {
        if (e?.matterId === matterId) { delete activity[id]; removed.activity += 1; }
      }
      write(KEYS.activity, activity);

      const tasks = read(KEYS.tasks, {});
      for (const [id, t] of Object.entries(tasks)) {
        if (t?.matterId === matterId) { delete tasks[id]; removed.tasks += 1; }
      }
      write(KEYS.tasks, tasks);

      // Sections are keyed by matter id at the top level, so the whole
      // branch goes -- fields and rows together.
      const sections = read(KEYS.sections, {});
      if (sections[matterId]) {
        removed.sectionRows = Object.values(sections[matterId])
          .reduce((n, s) => n + (s?.rows?.length || 0), 0);
        delete sections[matterId];
        write(KEYS.sections, sections);
      }

      // Both directions: a relation is deleted if EITHER end is gone,
      // matching the two cascading foreign keys on matter_relation.
      const relations = read(KEYS.relations, []);
      const kept = relations.filter((r) => r.fromId !== matterId && r.toId !== matterId);
      removed.relations = relations.length - kept.length;
      write(KEYS.relations, kept);

      /*
       * A contact is NOT deleted with the matter. It is a shared record --
       * the same person may be on another case, and a medical provider
       * certainly is. Postgres says the same thing with ON DELETE SET NULL.
       */
      regenerate();
      return { ok: true, matterId, caseNumber, children_removed: removed };
    },

    async createTask(input = {}) {
      const id = uuid();
      const tasks = read(KEYS.tasks, {});
      tasks[id] = {
        id,
        matterId: input.matterId || null,
        title: input.title || '',
        note: input.note || '',
        dueDate: input.dueDate || '',
        autoDueDate: null,
        manualOverride: false,
        assignedTo: input.assignedTo || 'Unassigned',
        completed: false,
        calendarSynced: false,
        source: 'manual',
        createdAt: new Date().toISOString(),
      };
      const r = write(KEYS.tasks, tasks);
      return r.ok ? { ok: true, id } : { ok: false, error: r.error };
    },

    async updateTask(taskId, patch) {
      const tasks = read(KEYS.tasks, {});
      const current = tasks[taskId];
      if (!current) return { ok: false, error: 'No such task' };
      const isOverride =
        current.source === 'auto' &&
        patch.dueDate !== undefined &&
        patch.dueDate !== current.autoDueDate;
      tasks[taskId] = {
        ...current,
        ...patch,
        manualOverride: isOverride || current.manualOverride,
      };
      return write(KEYS.tasks, tasks);
    },

    async setTaskComplete(taskId, completed) {
      return this.updateTask(taskId, {
        completed,
        completedAt: completed ? new Date().toISOString() : null,
      });
    },

    async clearTaskOverride(taskId) {
      const tasks = read(KEYS.tasks, {});
      const current = tasks[taskId];
      if (!current) return { ok: false, error: 'No such task' };
      tasks[taskId] = { ...current, manualOverride: false, dueDate: current.autoDueDate };
      return write(KEYS.tasks, tasks);
    },

    async deleteTask(taskId) {
      const tasks = read(KEYS.tasks, {});
      delete tasks[taskId];
      return write(KEYS.tasks, tasks);
    },

    async bulkSetComplete(taskIds, completed) {
      const tasks = read(KEYS.tasks, {});
      const stamp = completed ? new Date().toISOString() : null;
      for (const id of taskIds) {
        if (tasks[id]) tasks[id] = { ...tasks[id], completed, completedAt: stamp };
      }
      return write(KEYS.tasks, tasks);
    },

    async setSectionField(matterId, sectionKey, fieldKey, value) {
      const all = read(KEYS.sections, {});
      const forMatter = all[matterId] || {};
      const current = forMatter[sectionKey] || { fields: {}, rows: [] };
      all[matterId] = {
        ...forMatter,
        [sectionKey]: { ...current, fields: { ...current.fields, [fieldKey]: value } },
      };
      return write(KEYS.sections, all);
    },

    async addSectionRow(matterId, sectionKey, row = {}) {
      const all = read(KEYS.sections, {});
      const forMatter = all[matterId] || {};
      const current = forMatter[sectionKey] || { fields: {}, rows: [] };
      const id = uuid();
      all[matterId] = {
        ...forMatter,
        [sectionKey]: { ...current, rows: [...current.rows, { id, ...row }] },
      };
      const r = write(KEYS.sections, all);
      return r.ok ? { ok: true, id } : r;
    },

    async updateSectionRow(matterId, sectionKey, rowId, patch) {
      const all = read(KEYS.sections, {});
      const forMatter = all[matterId] || {};
      const current = forMatter[sectionKey] || { fields: {}, rows: [] };
      all[matterId] = {
        ...forMatter,
        [sectionKey]: {
          ...current,
          rows: current.rows.map((r) => (r.id === rowId ? { ...r, ...patch } : r)),
        },
      };
      return write(KEYS.sections, all);
    },

    async deleteSectionRow(matterId, sectionKey, rowId) {
      const all = read(KEYS.sections, {});
      const forMatter = all[matterId] || {};
      const current = forMatter[sectionKey] || { fields: {}, rows: [] };
      all[matterId] = {
        ...forMatter,
        [sectionKey]: { ...current, rows: current.rows.filter((r) => r.id !== rowId) },
      };
      return write(KEYS.sections, all);
    },

    async addActivity(input = {}) {
      const id = uuid();
      const activity = read(KEYS.activity, {});
      activity[id] = {
        id,
        matterId: input.matterId || null,
        kind: input.kind || 'note',
        body: input.body || '',
        author: input.author || 'You',
        pinned: false,
        mentions: input.mentions || [],
        attachments: input.attachments || [],
        assignedTo: input.assignedTo || null,
        dueDate: input.dueDate || null,
        completed: false,
        source: 'ui',
        createdAt: new Date().toISOString(),
      };
      const r = write(KEYS.activity, activity);
      return r.ok ? { ok: true, id } : { ok: false, error: r.error };
    },

    /**
     * File an email -- METADATA ONLY.
     *
     * localStorage has a ~5 MB quota for the entire app, so a single PDF
     * attachment would evict every matter on the device. The headers, body and
     * a list of what was attached are kept; the bytes are not. The card says so
     * rather than showing a link that cannot work, because a dead link on a
     * legal file reads as "the document was lost".
     */
    async addEmail({ matterId, parsed, normalized, author }) {
      const id = uuid();
      const activity = read(KEYS.activity, {});
      activity[id] = {
        id,
        matterId: matterId || null,
        kind: 'email',
        subject: normalized.meta.subject || '',
        body: normalized.body,
        meta: { ...normalized.meta, filesNotStored: true },
        dedupeKey: normalized.dedupeKey,
        attachments: parsed.attachments.map((a) => ({
          name: a.filename,
          contentType: a.contentType,
          size: a.bytes.length,
          role: 'attachment',
        })),
        author: author || 'Mail',
        pinned: false,
        mentions: [],
        source: 'ui',
        createdAt: new Date().toISOString(),
      };

      // Same dedupe rule as the unique index in 003_email.sql, enforced by hand
      // because localStorage has no constraints.
      if (normalized.dedupeKey) {
        const dup = Object.values(activity).find(
          (a) => a.id !== id && a.dedupeKey === normalized.dedupeKey
        );
        if (dup) return { ok: true, id: dup.id, duplicate: true };
      }

      const r = write(KEYS.activity, activity);
      // The stored row is returned, not just its id. The provider renders THIS
      // rather than rebuilding its own guess -- otherwise the card on screen
      // and the card after a reload can differ, which is how the missing
      // "attachments were not kept" warning went unnoticed the first time.
      return r.ok ? { ok: true, id, entry: activity[id] } : { ok: false, error: r.error };
    },

    async addRelation({ fromId, toId, kind, note }) {
      const relations = read(KEYS.relations, []);
      // Same normalisation as matter_relation_pair_uq: the link is undirected,
      // so entering it from either end is the same fact.
      const exists = relations.some(
        (r) =>
          (r.fromId === fromId && r.toId === toId) || (r.fromId === toId && r.toId === fromId)
      );
      if (exists) return { ok: true, duplicate: true };

      const relation = { id: uuid(), fromId, toId, kind: kind || 'Related', note: note || '' };
      const r = write(KEYS.relations, [...relations, relation]);
      return r.ok ? { ok: true, relation } : { ok: false, error: r.error };
    },

    async removeRelation(id) {
      const r = write(KEYS.relations, read(KEYS.relations, []).filter((x) => x.id !== id));
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    },

    /** No storage here, so nothing to sign. */
    async signFile() {
      return { ok: false, error: 'Attachments are not stored in local mode.' };
    },

    async updateActivity(id, patch) {
      const activity = read(KEYS.activity, {});
      if (!activity[id]) return { ok: false, error: 'No such entry' };
      activity[id] = { ...activity[id], ...patch };
      return write(KEYS.activity, activity);
    },

    async deleteActivity(id) {
      const activity = read(KEYS.activity, {});
      delete activity[id];
      return write(KEYS.activity, activity);
    },

    async assignActivityAsTask(id, { assignedTo, dueDate }) {
      return this.updateActivity(id, { kind: 'task', assignedTo, dueDate });
    },

    async saveTeam(next) {
      return write(KEYS.team, next);
    },
  };
}
