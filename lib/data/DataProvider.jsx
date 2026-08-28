'use client';

/**
 * The data layer.
 *
 * Twenty-one per-record intents — createMatter, updateMatterField,
 * setChecklistItem, addSectionRow, and so on. Never whole-collection writes.
 * See docs/DECISIONS.md, "Do NOT build a storage-shaped adapter and swap its
 * implementation": preserving a `set(key, entireCollection)` shape would have
 * made a per-keystroke full-blob write structural, and then swapping in HTTP
 * would mean every keystroke POSTs every matter.
 *
 * Two stores implement the same interface:
 *   lib/data/supabase-store.js — Postgres, used when configured
 *   lib/data/local-store.js    — localStorage, the pre-Supabase fallback
 *
 * No component, page, or route knows which is active.
 *
 * Writes are OPTIMISTIC: local state updates immediately so typing never waits
 * on a round-trip, and the store call reports failure into `saveState`, which
 * `SaveIndicator` renders. Errors are never swallowed — a silent save failure
 * on a legal file is the one outcome this system must not have.
 */

import {
  createContext, useContext, useEffect, useMemo, useRef, useState, useCallback,
} from 'react';
import { emptyValues, emptyDocValue, DOC_FIELDS } from '@/lib/domain/fields';
import { generateChainTasks } from '@/lib/domain/chain';
import { todayInFirmTz } from '@/lib/domain/dates';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { createLocalStore } from './local-store';
import { createSupabaseStore } from './supabase-store';
import { readEmailFile } from '@/lib/data/email-ingest';

const DataContext = createContext(null);

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
  // Derived from the env on the first render, not after the load effect. It
  // used to start as 'local', so the user menu's first paint claimed "running
  // on browser storage" even when Supabase was configured -- which reads as
  // "the database isn't linked".
  const [backend, setBackend] = useState(() =>
    typeof window !== 'undefined' && isSupabaseConfigured() ? 'supabase' : 'local'
  );
  const [currentUser, setCurrentUser] = useState(null);
  const [saveState, setSaveState] = useState({ status: 'idle', error: null });

  const storeRef = useRef(null);
  if (!storeRef.current && typeof window !== 'undefined') {
    const useSupabase = isSupabaseConfigured();
    storeRef.current = useSupabase ? createSupabaseStore() : createLocalStore();
  }

  // Freshest collections, for mutations that need to read before writing.
  // READS during render must come from state, not this ref -- the ref syncs in
  // an effect that runs after render, so a render triggered by the initial load
  // would see stale data with no second render to correct it.
  const ref = useRef({ matters, tasks, sections, activity });
  useEffect(() => {
    ref.current = { matters, tasks, sections, activity };
  }, [matters, tasks, sections, activity]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const store = storeRef.current;
      if (!store) return;

      const usingSupabase = isSupabaseConfigured();
      setBackend(usingSupabase ? 'supabase' : 'local');

      // Don't query while signed out. RLS would return nothing anyway, and the
      // failed requests surfaced as a red "Not saved" on the login page, which
      // reads as a broken app rather than an unauthenticated one.
      if (usingSupabase) {
        const { getSupabaseBrowserClient } = await import('@/lib/supabase/client');
        const db = getSupabaseBrowserClient();
        const { data } = await db.auth.getSession();
        if (!data?.session) {
          if (!cancelled) setLoaded(true);
          return;
        }
        // Who is signed in. Needed for the user menu, for stamping note
        // authorship, and for @mention resolution.
        const authUser = data.session.user;
        const { data: prof } = await db
          .from('profile')
          .select('*')
          .eq('id', authUser.id)
          .maybeSingle();
        if (!cancelled) {
          setCurrentUser({
            id: authUser.id,
            email: authUser.email,
            handle: prof?.handle || authUser.email?.split('@')[0],
            displayName: prof?.display_name || authUser.email?.split('@')[0],
            role: prof?.role || 'paralegal',
          });
        }
      }

      try {
        const data = await store.loadAll();
        if (cancelled) return;
        setMatters(data.matters || {});
        setTasks(data.tasks || {});
        setActivity(data.activity || {});
        setSections(data.sections || {});
        setTeam(data.team || {});
      } catch (err) {
        if (cancelled) return;
        // PGRST205 means the tables aren't there yet. That is a setup step, not
        // a save failure, and saying so beats a generic error.
        const raw = err?.message || 'Could not load data';
        const needsSchema = /PGRST205|schema cache|does not exist/i.test(raw);
        setSaveState({
          status: 'error',
          error: needsSchema
            ? 'Database tables not found — run supabase/schema.sql in the Supabase SQL editor.'
            : raw,
        });
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Run a store call and surface the outcome. Never swallows. */
  const run = useCallback(async (fn) => {
    setSaveState({ status: 'saving', error: null });
    try {
      const result = (await fn(storeRef.current)) || { ok: true };
      setSaveState(
        result.ok
          ? { status: 'saved', error: null }
          : { status: 'error', error: result.error || 'Save failed' }
      );
      return result;
    } catch (err) {
      const error = err?.message || 'Save failed';
      setSaveState({ status: 'error', error });
      return { ok: false, error };
    }
  }, []);

  /** Optimistically update matters locally, then regenerate the chain locally. */
  const applyMatters = useCallback((next) => {
    setMatters(next);
    const regenerated = generateChainTasks(next, ref.current.tasks);
    setTasks(regenerated);
    ref.current = { ...ref.current, matters: next, tasks: regenerated };
  }, []);

  /* ---------------- Matter intents ---------------- */

  const createMatter = useCallback(
    async (input = {}) => {
      const result = await run((s) => s.createMatter(input));
      if (!result.ok) return result;

      const values = { ...emptyValues(), ...input };
      if (result.caseNumber) values.caseNumber = result.caseNumber;
      if (!values.openDate) values.openDate = todayInFirmTz();

      applyMatters({
        ...ref.current.matters,
        [result.id]: {
          values,
          createdAt: new Date().toISOString(),
          lastActivityAt: new Date().toISOString(),
        },
      });
      return result;
    },
    [run, applyMatters]
  );

  const updateMatterField = useCallback(
    (matterId, fieldKey, value) => {
      const current = ref.current.matters[matterId];
      if (!current) return Promise.resolve({ ok: false, error: 'No such matter' });

      applyMatters({
        ...ref.current.matters,
        [matterId]: {
          ...current,
          values: { ...current.values, [fieldKey]: value },
          lastActivityAt: new Date().toISOString(),
        },
      });
      return run((s) => s.updateMatterField(matterId, fieldKey, value));
    },
    [run, applyMatters]
  );

  const setChecklistItem = useCallback(
    (matterId, fieldKey, patch) => {
      if (!DOC_FIELDS.has(fieldKey)) {
        return Promise.resolve({ ok: false, error: `${fieldKey} is not a checklist item` });
      }
      const current = ref.current.matters[matterId];
      if (!current) return Promise.resolve({ ok: false, error: 'No such matter' });

      const merged = { ...(current.values[fieldKey] || emptyDocValue()), ...patch };
      applyMatters({
        ...ref.current.matters,
        [matterId]: {
          ...current,
          values: { ...current.values, [fieldKey]: merged },
          lastActivityAt: new Date().toISOString(),
        },
      });
      return run((s) => s.setChecklistItem(matterId, fieldKey, patch));
    },
    [run, applyMatters]
  );

  const archiveMatter = useCallback(
    (matterId) => {
      const current = ref.current.matters[matterId];
      if (!current) return Promise.resolve({ ok: false, error: 'No such matter' });
      applyMatters({
        ...ref.current.matters,
        [matterId]: { ...current, archivedAt: new Date().toISOString() },
      });
      return run((s) => s.archiveMatter(matterId));
    },
    [run, applyMatters]
  );

  const unarchiveMatter = useCallback(
    (matterId) => {
      const current = ref.current.matters[matterId];
      if (!current) return Promise.resolve({ ok: false, error: 'No such matter' });
      const { archivedAt, ...rest } = current;
      applyMatters({ ...ref.current.matters, [matterId]: rest });
      return run((s) => s.unarchiveMatter(matterId));
    },
    [run, applyMatters]
  );

  /* ---------------- Task intents ---------------- */

  const applyTasks = useCallback((next) => {
    setTasks(next);
    ref.current = { ...ref.current, tasks: next };
  }, []);

  const createTask = useCallback(
    async (input = {}) => {
      const result = await run((s) => s.createTask(input));
      if (!result.ok) return result;
      applyTasks({
        ...ref.current.tasks,
        [result.id]: {
          id: result.id,
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
        },
      });
      return result;
    },
    [run, applyTasks]
  );

  const updateTask = useCallback(
    (taskId, patch) => {
      const current = ref.current.tasks[taskId];
      if (!current) return Promise.resolve({ ok: false, error: 'No such task' });
      const isOverride =
        current.source === 'auto' &&
        patch.dueDate !== undefined &&
        patch.dueDate !== current.autoDueDate;
      applyTasks({
        ...ref.current.tasks,
        [taskId]: { ...current, ...patch, manualOverride: isOverride || current.manualOverride },
      });
      return run((s) => s.updateTask(taskId, patch));
    },
    [run, applyTasks]
  );

  const setTaskComplete = useCallback(
    (taskId, completed) => updateTask(taskId, { completed }),
    [updateTask]
  );

  const clearTaskOverride = useCallback(
    (taskId) => {
      const current = ref.current.tasks[taskId];
      if (!current) return Promise.resolve({ ok: false, error: 'No such task' });
      applyTasks({
        ...ref.current.tasks,
        [taskId]: { ...current, manualOverride: false, dueDate: current.autoDueDate },
      });
      return run((s) => s.clearTaskOverride(taskId));
    },
    [run, applyTasks]
  );

  const deleteTask = useCallback(
    (taskId) => {
      const next = { ...ref.current.tasks };
      delete next[taskId];
      applyTasks(next);
      return run((s) => s.deleteTask(taskId));
    },
    [run, applyTasks]
  );

  const bulkSetComplete = useCallback(
    (taskIds, completed) => {
      const next = { ...ref.current.tasks };
      for (const id of taskIds) if (next[id]) next[id] = { ...next[id], completed };
      applyTasks(next);
      return run((s) => s.bulkSetComplete(taskIds, completed));
    },
    [run, applyTasks]
  );

  /* ---------------- Generic section intents ---------------- */

  // Reads from STATE, not the ref -- see the note on `ref` above.
  const sectionState = useCallback(
    (matterId, sectionKey) => sections?.[matterId]?.[sectionKey] || { fields: {}, rows: [] },
    [sections]
  );

  const applySection = useCallback((matterId, sectionKey, updater) => {
    const all = ref.current.sections || {};
    const forMatter = all[matterId] || {};
    const current = forMatter[sectionKey] || { fields: {}, rows: [] };
    const next = { ...all, [matterId]: { ...forMatter, [sectionKey]: updater(current) } };
    setSections(next);
    ref.current = { ...ref.current, sections: next };
  }, []);

  const setSectionField = useCallback(
    (matterId, sectionKey, fieldKey, value) => {
      applySection(matterId, sectionKey, (s) => ({
        ...s,
        fields: { ...s.fields, [fieldKey]: value },
      }));
      return run((s) => s.setSectionField(matterId, sectionKey, fieldKey, value));
    },
    [run, applySection]
  );

  const addSectionRow = useCallback(
    async (matterId, sectionKey, row = {}) => {
      const optimisticId = uuid();
      applySection(matterId, sectionKey, (s) => ({
        ...s,
        rows: [...s.rows, { id: optimisticId, ...row }],
      }));
      const result = await run((s) => s.addSectionRow(matterId, sectionKey, row));
      // Reconcile the optimistic id with the one the store assigned.
      if (result.ok && result.id && result.id !== optimisticId) {
        applySection(matterId, sectionKey, (s) => ({
          ...s,
          rows: s.rows.map((r) => (r.id === optimisticId ? { ...r, id: result.id } : r)),
        }));
      }
      return result;
    },
    [run, applySection]
  );

  const updateSectionRow = useCallback(
    (matterId, sectionKey, rowId, patch) => {
      applySection(matterId, sectionKey, (s) => ({
        ...s,
        rows: s.rows.map((r) => (r.id === rowId ? { ...r, ...patch } : r)),
      }));
      return run((s) => s.updateSectionRow(matterId, sectionKey, rowId, patch));
    },
    [run, applySection]
  );

  const deleteSectionRow = useCallback(
    (matterId, sectionKey, rowId) => {
      applySection(matterId, sectionKey, (s) => ({
        ...s,
        rows: s.rows.filter((r) => r.id !== rowId),
      }));
      return run((s) => s.deleteSectionRow(matterId, sectionKey, rowId));
    },
    [run, applySection]
  );

  /* ---------------- Activity intents ---------------- */

  const applyActivity = useCallback((next) => {
    setActivity(next);
    ref.current = { ...ref.current, activity: next };
  }, []);

  const addActivity = useCallback(
    async (input = {}) => {
      const optimisticId = uuid();
      const entry = {
        id: optimisticId,
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
      applyActivity({ ...ref.current.activity, [optimisticId]: entry });

      const result = await run((s) => s.addActivity(input));
      if (result.ok && result.id && result.id !== optimisticId) {
        const next = { ...ref.current.activity };
        delete next[optimisticId];
        next[result.id] = { ...entry, id: result.id };
        applyActivity(next);
      }
      return result;
    },
    [run, applyActivity]
  );

  /**
   * File an email on a matter from a dropped .eml.
   *
   * Deliberately NOT optimistic, unlike every other intent here. The others
   * write a value the user just typed and can see; this one uploads files that
   * may take seconds and may fail on size or network. Showing the card first
   * would mean showing correspondence on a legal file that is not actually
   * stored -- so the card appears when the upload has landed, and the drop zone
   * shows progress in the meantime.
   */
  const addEmail = useCallback(
    async (file, { matterId, author } = {}) => {
      const read = await readEmailFile(file, { matterId });
      if (!read.ok) return read;

      const result = await run((s) =>
        s.addEmail({
          matterId,
          parsed: read.parsed,
          bytes: read.bytes,
          normalized: read.normalized,
          author: author || read.normalized.meta.from?.name || 'Mail',
        })
      );
      if (!result.ok) return result;

      // A duplicate leaves the existing row alone -- re-filing the same message
      // must not overwrite whatever someone has already done to that card.
      if (!result.duplicate && result.entry) {
        applyActivity({ ...ref.current.activity, [result.id]: result.entry });
      }
      return result;
    },
    [run, applyActivity]
  );

  /** Short-lived read URL for a stored attachment. Minted per click. */
  const signFile = useCallback((path) => run((s) => s.signFile(path)), [run]);

  const updateActivity = useCallback(
    (id, patch) => {
      const current = ref.current.activity[id];
      if (!current) return Promise.resolve({ ok: false, error: 'No such entry' });
      applyActivity({ ...ref.current.activity, [id]: { ...current, ...patch } });
      return run((s) => s.updateActivity(id, patch));
    },
    [run, applyActivity]
  );

  const deleteActivity = useCallback(
    (id) => {
      const next = { ...ref.current.activity };
      delete next[id];
      applyActivity(next);
      return run((s) => s.deleteActivity(id));
    },
    [run, applyActivity]
  );

  /** "Assign as Task" — an UPDATE, not an INSERT. Promotes the note in place. */
  const assignActivityAsTask = useCallback(
    (id, { assignedTo, dueDate }) => updateActivity(id, { kind: 'task', assignedTo, dueDate }),
    [updateActivity]
  );

  const saveTeam = useCallback(
    (next) => {
      setTeam(next);
      return run((s) => s.saveTeam(next));
    },
    [run]
  );

  const value = useMemo(
    () => ({
      matters, tasks, team, sections, activity, loaded, saveState, backend, currentUser,
      createMatter, updateMatterField, setChecklistItem, archiveMatter, unarchiveMatter,
      createTask, updateTask, setTaskComplete, clearTaskOverride, deleteTask, bulkSetComplete,
      sectionState, setSectionField, addSectionRow, updateSectionRow, deleteSectionRow,
      addActivity, addEmail, signFile, updateActivity, deleteActivity, assignActivityAsTask, saveTeam,
    }),
    [
      matters, tasks, team, sections, activity, loaded, saveState, backend, currentUser,
      createMatter, updateMatterField, setChecklistItem, archiveMatter, unarchiveMatter,
      createTask, updateTask, setTaskComplete, clearTaskOverride, deleteTask, bulkSetComplete,
      sectionState, setSectionField, addSectionRow, updateSectionRow, deleteSectionRow,
      addActivity, addEmail, signFile, updateActivity, deleteActivity, assignActivityAsTask, saveTeam,
    ]
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used inside <DataProvider>');
  return ctx;
}

/** Convenience: one matter plus its tasks. */
export function useMatter(matterId) {
  const { matters, tasks } = useData();
  const matter = matters[matterId] || null;
  const matterTasks = useMemo(
    () => Object.values(tasks).filter((t) => t.matterId === matterId),
    [tasks, matterId]
  );
  return { matter, tasks: matterTasks };
}
