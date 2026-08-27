'use client';

/**
 * Client-side data layer.
 *
 * The interface here is deliberately the PRODUCTION interface: per-record
 * intents, not whole-collection writes. See docs/DECISIONS.md, "Do NOT build a
 * storage-shaped adapter and swap its implementation."
 *
 *   createMatter, updateMatterField, setChecklistItem, archiveMatter
 *   createTask, updateTask, setTaskComplete, deleteTask
 *   setSectionData, addSectionRow, updateSectionRow, deleteSectionRow
 *
 * Today each of these persists by writing its collection to localStorage,
 * because there is no backend yet. That is an implementation detail of THIS
 * FILE. When the API lands, only the bodies change — no call site moves. The
 * prototype's `persistMatters(entireCollection)` shape is gone, which is what
 * kept a per-keystroke full-blob write from becoming a per-keystroke HTTP POST.
 *
 * It also removes the prototype's stale-closure bug by construction: a mutation
 * that takes (matterId, fieldKey, patch) has no whole-collection object to
 * rebuild from a render closure.
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { emptyValues, emptyDocValue, DOC_FIELDS } from '@/lib/domain/fields';
import { generateChainTasks } from '@/lib/domain/chain';
import { todayInFirmTz } from '@/lib/domain/dates';

const KEYS = {
  matters: 'case-records',
  tasks: 'firm-tasks',
  team: 'team-directory',
  sections: 'matter-sections',
  activity: 'matter-activity',
};

const DataContext = createContext(null);

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
    // Errors are surfaced, never swallowed. The prototype had .catch(() => {})
    // at every persist site, so "the paralegal marked Served done, it didn't
    // save, and nobody found out" was a reachable state.
    return { ok: false, error: err?.message || 'Save failed' };
  }
}

const uuid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

export function DataProvider({ children }) {
  const [matters, setMatters] = useState({});
  const [tasks, setTasks] = useState({});
  const [team, setTeam] = useState({});
  const [sections, setSections] = useState({});
  const [activity, setActivity] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState({ status: 'idle', error: null });

  // Always read the freshest collection when mutating, so two edits in one tick
  // cannot lose each other.
  const ref = useRef({ matters, tasks, team, sections, activity });
  useEffect(() => {
    ref.current = { matters, tasks, team, sections, activity };
  }, [matters, tasks, team, sections, activity]);

  useEffect(() => {
    const m = read(KEYS.matters, {});
    const t = read(KEYS.tasks, {});
    setMatters(m);
    setTasks(generateChainTasks(m, t));
    setTeam(read(KEYS.team, {}));
    setSections(read(KEYS.sections, {}));
    setActivity(read(KEYS.activity, {}));
    setLoaded(true);
  }, []);

  const report = useCallback((result) => {
    if (result.ok) setSaveState({ status: 'saved', error: null });
    else setSaveState({ status: 'error', error: result.error });
    return result;
  }, []);

  /** Persist matters, then regenerate the chain from the SAME next-state. */
  const commitMatters = useCallback(
    (next) => {
      setMatters(next);
      const r1 = write(KEYS.matters, next);
      const regenerated = generateChainTasks(next, ref.current.tasks);
      setTasks(regenerated);
      const r2 = write(KEYS.tasks, regenerated);
      ref.current = { ...ref.current, matters: next, tasks: regenerated };
      return report(r1.ok ? r2 : r1);
    },
    [report]
  );

  const commitTasks = useCallback(
    (next) => {
      setTasks(next);
      ref.current = { ...ref.current, tasks: next };
      return report(write(KEYS.tasks, next));
    },
    [report]
  );

  const commitSections = useCallback(
    (next) => {
      setSections(next);
      ref.current = { ...ref.current, sections: next };
      return report(write(KEYS.sections, next));
    },
    [report]
  );

  const commitActivity = useCallback(
    (next) => {
      setActivity(next);
      ref.current = { ...ref.current, activity: next };
      return report(write(KEYS.activity, next));
    },
    [report]
  );

  /* ---------------- Matter intents ---------------- */

  const createMatter = useCallback(
    (input = {}) => {
      const id = uuid();
      const values = { ...emptyValues(), ...input };
      if (!values.openDate) values.openDate = todayInFirmTz();
      const next = {
        ...ref.current.matters,
        [id]: { values, createdAt: new Date().toISOString(), lastActivityAt: new Date().toISOString() },
      };
      commitMatters(next);
      return { id, caseNumber: values.caseNumber || '' };
    },
    [commitMatters]
  );

  const updateMatterField = useCallback(
    (matterId, fieldKey, value) => {
      const current = ref.current.matters[matterId];
      if (!current) return { ok: false, error: 'No such matter' };
      const next = {
        ...ref.current.matters,
        [matterId]: {
          ...current,
          values: { ...current.values, [fieldKey]: value },
          lastActivityAt: new Date().toISOString(),
        },
      };
      return commitMatters(next);
    },
    [commitMatters]
  );

  const setChecklistItem = useCallback(
    (matterId, fieldKey, patch) => {
      if (!DOC_FIELDS.has(fieldKey)) return { ok: false, error: `${fieldKey} is not a checklist item` };
      const current = ref.current.matters[matterId];
      if (!current) return { ok: false, error: 'No such matter' };
      const existing = current.values[fieldKey] || emptyDocValue();
      return updateMatterField(matterId, fieldKey, { ...existing, ...patch });
    },
    [updateMatterField]
  );

  const archiveMatter = useCallback(
    (matterId) => {
      const current = ref.current.matters[matterId];
      if (!current) return { ok: false, error: 'No such matter' };
      const next = {
        ...ref.current.matters,
        [matterId]: { ...current, archivedAt: new Date().toISOString() },
      };
      return commitMatters(next);
    },
    [commitMatters]
  );

  const unarchiveMatter = useCallback(
    (matterId) => {
      const current = ref.current.matters[matterId];
      if (!current) return { ok: false, error: 'No such matter' };
      const { archivedAt, ...rest } = current;
      return commitMatters({ ...ref.current.matters, [matterId]: rest });
    },
    [commitMatters]
  );

  /* ---------------- Task intents ---------------- */

  const createTask = useCallback(
    (input = {}) => {
      const id = uuid();
      const task = {
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
      commitTasks({ ...ref.current.tasks, [id]: task });
      return { id };
    },
    [commitTasks]
  );

  const updateTask = useCallback(
    (taskId, patch) => {
      const current = ref.current.tasks[taskId];
      if (!current) return { ok: false, error: 'No such task' };
      // Setting a date by hand on an auto task is the manualOverride path -- the
      // flag the prototype read in three places and no UI ever set.
      const isOverride =
        current.source === 'auto' && patch.dueDate !== undefined && patch.dueDate !== current.autoDueDate;
      return commitTasks({
        ...ref.current.tasks,
        [taskId]: { ...current, ...patch, manualOverride: isOverride || current.manualOverride },
      });
    },
    [commitTasks]
  );

  const setTaskComplete = useCallback(
    (taskId, completed) =>
      updateTask(taskId, {
        completed,
        completedAt: completed ? new Date().toISOString() : null,
      }),
    [updateTask]
  );

  const clearTaskOverride = useCallback(
    (taskId) => {
      const current = ref.current.tasks[taskId];
      if (!current) return { ok: false, error: 'No such task' };
      return commitTasks({
        ...ref.current.tasks,
        [taskId]: { ...current, manualOverride: false, dueDate: current.autoDueDate },
      });
    },
    [commitTasks]
  );

  const deleteTask = useCallback(
    (taskId) => {
      const next = { ...ref.current.tasks };
      delete next[taskId];
      return commitTasks(next);
    },
    [commitTasks]
  );

  const bulkSetComplete = useCallback(
    (taskIds, completed) => {
      const next = { ...ref.current.tasks };
      const stamp = completed ? new Date().toISOString() : null;
      for (const id of taskIds) {
        if (next[id]) next[id] = { ...next[id], completed, completedAt: stamp };
      }
      return commitTasks(next);
    },
    [commitTasks]
  );

  /* ---------------- Generic section intents ---------------- */

  /**
   * READ path — must come from state, not from `ref`.
   *
   * `ref.current` is synced in an effect that runs AFTER render, so a component
   * calling this during the render triggered by the initial load would read the
   * pre-load `{}` and paint an empty section, with no further render to correct
   * it. The ref exists only so MUTATIONS see the freshest collection.
   */
  const sectionState = useCallback(
    (matterId, sectionKey) => sections?.[matterId]?.[sectionKey] || { fields: {}, rows: [] },
    [sections]
  );

  const writeSection = useCallback(
    (matterId, sectionKey, updater) => {
      const all = ref.current.sections || {};
      const forMatter = all[matterId] || {};
      const current = forMatter[sectionKey] || { fields: {}, rows: [] };
      return commitSections({
        ...all,
        [matterId]: { ...forMatter, [sectionKey]: updater(current) },
      });
    },
    [commitSections]
  );

  const setSectionField = useCallback(
    (matterId, sectionKey, fieldKey, value) =>
      writeSection(matterId, sectionKey, (s) => ({ ...s, fields: { ...s.fields, [fieldKey]: value } })),
    [writeSection]
  );

  const addSectionRow = useCallback(
    (matterId, sectionKey, row = {}) =>
      writeSection(matterId, sectionKey, (s) => ({ ...s, rows: [...s.rows, { id: uuid(), ...row }] })),
    [writeSection]
  );

  const updateSectionRow = useCallback(
    (matterId, sectionKey, rowId, patch) =>
      writeSection(matterId, sectionKey, (s) => ({
        ...s,
        rows: s.rows.map((r) => (r.id === rowId ? { ...r, ...patch } : r)),
      })),
    [writeSection]
  );

  const deleteSectionRow = useCallback(
    (matterId, sectionKey, rowId) =>
      writeSection(matterId, sectionKey, (s) => ({ ...s, rows: s.rows.filter((r) => r.id !== rowId) })),
    [writeSection]
  );

  /* ---------------- Activity intents ---------------- */

  const addActivity = useCallback(
    (input = {}) => {
      const id = uuid();
      const entry = {
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
        source: input.source || 'ui',
        createdAt: new Date().toISOString(),
      };
      commitActivity({ ...ref.current.activity, [id]: entry });
      return { id };
    },
    [commitActivity]
  );

  const updateActivity = useCallback(
    (id, patch) => {
      const current = ref.current.activity[id];
      if (!current) return { ok: false, error: 'No such entry' };
      return commitActivity({ ...ref.current.activity, [id]: { ...current, ...patch } });
    },
    [commitActivity]
  );

  const deleteActivity = useCallback(
    (id) => {
      const next = { ...ref.current.activity };
      delete next[id];
      return commitActivity(next);
    },
    [commitActivity]
  );

  /** "Assign as Task" — an UPDATE, not an INSERT. Filevine promotes in place. */
  const assignActivityAsTask = useCallback(
    (id, { assignedTo, dueDate }) => updateActivity(id, { kind: 'task', assignedTo, dueDate }),
    [updateActivity]
  );

  const saveTeam = useCallback(
    (next) => {
      setTeam(next);
      ref.current = { ...ref.current, team: next };
      return report(write(KEYS.team, next));
    },
    [report]
  );

  const value = useMemo(
    () => ({
      matters,
      tasks,
      team,
      sections,
      activity,
      loaded,
      saveState,
      createMatter,
      updateMatterField,
      setChecklistItem,
      archiveMatter,
      unarchiveMatter,
      createTask,
      updateTask,
      setTaskComplete,
      clearTaskOverride,
      deleteTask,
      bulkSetComplete,
      sectionState,
      setSectionField,
      addSectionRow,
      updateSectionRow,
      deleteSectionRow,
      addActivity,
      updateActivity,
      deleteActivity,
      assignActivityAsTask,
      saveTeam,
    }),
    [
      matters, tasks, team, sections, activity, loaded, saveState,
      createMatter, updateMatterField, setChecklistItem, archiveMatter, unarchiveMatter,
      createTask, updateTask, setTaskComplete, clearTaskOverride, deleteTask, bulkSetComplete,
      sectionState, setSectionField, addSectionRow, updateSectionRow, deleteSectionRow,
      addActivity, updateActivity, deleteActivity, assignActivityAsTask, saveTeam,
    ]
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used inside <DataProvider>');
  return ctx;
}

/** Convenience: one matter plus its derived bits. */
export function useMatter(matterId) {
  const { matters, tasks } = useData();
  const matter = matters[matterId] || null;
  const matterTasks = useMemo(
    () => Object.values(tasks).filter((t) => t.matterId === matterId),
    [tasks, matterId]
  );
  return { matter, tasks: matterTasks };
}
