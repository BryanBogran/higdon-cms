'use client';

/**
 * Create a manual task.
 *
 * The requirements note asks for this directly: "A task section for people to
 * upload tasks and then send an email and deadline for the assigned person."
 * The Tasks page was read-only — it could only ever show deadlines the chain
 * generated, so a paralegal had no way to record ordinary work.
 *
 * The email half of that requirement is Phase 13 (the cron reminder engine).
 * This is the half that has to exist first.
 */

import { useMemo, useState } from 'react';
import { X, Plus, AlertTriangle } from 'lucide-react';
import { useData } from '@/lib/data/DataProvider';
import { matterTitle } from '@/lib/domain/matter';
import { checkBadDate, fmt, nextBusinessDay, todayInFirmTz } from '@/lib/domain/dates';

export default function AddTaskDialog({ open, onClose, matterId: fixedMatterId }) {
  const { matters, team, currentUser, createTask } = useData();
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [matterId, setMatterId] = useState(fixedMatterId || '');
  const [assignedTo, setAssignedTo] = useState('');
  const [busy, setBusy] = useState(false);

  const matterOptions = useMemo(
    () =>
      Object.entries(matters)
        .filter(([, m]) => !m.archivedAt)
        .map(([id, m]) => ({ id, title: matterTitle(m) }))
        .sort((a, b) => a.title.localeCompare(b.title)),
    [matters]
  );

  const assignees = useMemo(() => {
    const names = new Set(Object.keys(team || {}));
    if (currentUser?.displayName) names.add(currentUser.displayName);
    return [...names].sort();
  }, [team, currentUser]);

  if (!open) return null;

  const bad = checkBadDate(dueDate);

  async function submit(e) {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    await createTask({
      title: title.trim(),
      note: note.trim(),
      dueDate: dueDate || '',
      matterId: matterId || null,
      assignedTo: assignedTo || 'Unassigned',
    });
    setBusy(false);
    setTitle('');
    setNote('');
    setDueDate('');
    setAssignedTo('');
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" onMouseDown={onClose}>
      <form
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-lg bg-white rounded-xl shadow-xl border border-slate-200"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900">New Task</h2>
          <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
              Task
            </label>
            <input
              autoFocus
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Order medical records from Village ER"
            />
          </div>

          {!fixedMatterId ? (
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
                Case
              </label>
              <select className="input" value={matterId} onChange={(e) => setMatterId(e.target.value)}>
                <option value="">No case (firm-wide)</option>
                {matterOptions.map((m) => (
                  <option key={m.id} value={m.id}>{m.title}</option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
                Due
              </label>
              <input
                type="date"
                className="input"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
              <div className="flex gap-2 mt-1.5">
                <button
                  type="button"
                  onClick={() => setDueDate(todayInFirmTz())}
                  className="text-[11px] text-teal-700 hover:underline"
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => setDueDate(nextBusinessDay(todayInFirmTz()))}
                  className="text-[11px] text-teal-700 hover:underline"
                >
                  Next business day
                </button>
              </div>
              {bad ? (
                <p className="flex items-center gap-1 mt-1 text-[11px] text-amber-700">
                  <AlertTriangle size={12} /> Falls on a {bad}.{' '}
                  <button
                    type="button"
                    onClick={() => setDueDate(nextBusinessDay(dueDate))}
                    className="underline font-semibold"
                  >
                    Move to {fmt(nextBusinessDay(dueDate))}
                  </button>
                </p>
              ) : null}
            </div>

            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
                Assigned to
              </label>
              <select className="input" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
                <option value="">Unassigned</option>
                {assignees.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
              Note <span className="font-normal normal-case text-slate-400">(optional)</span>
            </label>
            <textarea
              className="input min-h-[70px]"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>

        <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm text-slate-600 hover:text-slate-900">
            Cancel
          </button>
          <button
            type="submit"
            disabled={!title.trim() || busy}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold disabled:opacity-40 hover:bg-slate-800"
          >
            <Plus size={15} /> {busy ? 'Adding…' : 'Add Task'}
          </button>
        </div>
      </form>
    </div>
  );
}
