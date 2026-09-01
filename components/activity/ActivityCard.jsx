'use client';

/**
 * One activity entry.
 *
 * This single card is the matter Activity feed, the global Feed, AND the Tasks
 * list — because in Filevine a task IS a note that carries an assignee and a due
 * date. Same object, same card, filtered differently. See docs/DECISIONS.md,
 * "A task IS an activity entry".
 *
 * "Assign as Task" is an UPDATE, not an INSERT. That is why Filevine can promote
 * a note in place, and it would have been awkward across two tables.
 *
 * ── The promotion has to ASK ──────────────────────────────────────────────
 *
 * It used to send `{ assignedTo: 'Unassigned', dueDate: '' }` -- hard-coded,
 * no prompt -- so the two things that make a note a task were the two things
 * you could not set. The result was a task with nobody on it and no date,
 * which is a note with a different icon. Worse, the footer of a task rendered
 * the assignee and the due date as plain text, so there was no second chance
 * either: once promoted, it could not be assigned at all.
 *
 * Both are fields now. Promotion opens a small form, and an existing task's
 * assignee and due date are editable in place.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Pin, MoreVertical, CheckCircle2, Circle, ListPlus, Paperclip, Trash2, Pencil, Check, X, AlertTriangle } from 'lucide-react';
import { fmt, urgency, nextBusinessDay, todayInFirmTz, checkBadDate } from '@/lib/domain/dates';
import { matterTitle, avatarColor } from '@/lib/domain/matter';
import { useData } from '@/lib/data/DataProvider';
import { assigneeOptions, UNASSIGNED } from '@/lib/domain/team';
import EmailBody from './EmailBody';

const KIND_ICON_BG = {
  note: 'bg-warn-solid-2',
  task: 'bg-accent-solid-2',
  call: 'bg-info-solid',
  text: 'bg-violet-500',
  email: 'bg-indigo-500',
  fax: 'bg-ink-3',
  system: 'bg-line-strong',
};

/** The assignee picker. One control, used by the promote form and the footer. */
function AssigneeSelect({ value, onChange, options, id }) {
  return (
    <select
      id={id}
      className="rounded border border-line-strong px-2 py-1 text-sm bg-surface"
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{UNASSIGNED}</option>
      {options.map((name) => (
        <option key={name} value={name}>{name}</option>
      ))}
      {/*
        A name that is on the task but not in the roster still has to render,
        or opening the card would silently reassign it to Unassigned on the
        next save. assigneeOptions folds task history in, so this is a
        belt-and-braces case -- a name arriving from an import, say.
      */}
      {value && value !== UNASSIGNED && !options.includes(value)
        ? <option value={value}>{value}</option>
        : null}
    </select>
  );
}

/** A due date with the two shortcuts people actually use, and the weekend warning. */
function DueDateInput({ value, onChange, id }) {
  const bad = checkBadDate(value);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <input
        id={id}
        type="date"
        className="rounded border border-line-strong px-2 py-1 text-sm bg-surface"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
      />
      <button type="button" onClick={() => onChange(todayInFirmTz())}
        className="text-[11px] text-accent-ink hover:underline">Today</button>
      <button type="button" onClick={() => onChange(nextBusinessDay(todayInFirmTz()))}
        className="text-[11px] text-accent-ink hover:underline">Next business day</button>
      {bad ? (
        <span className="flex items-center gap-1 text-[11px] text-warn-ink">
          <AlertTriangle size={12} /> Falls on a {bad}.
          <button type="button" onClick={() => onChange(nextBusinessDay(value))}
            className="underline font-semibold">Move to {fmt(nextBusinessDay(value))}</button>
        </span>
      ) : null}
    </span>
  );
}

export default function ActivityCard({ entry, showMatter = true }) {
  const { matters, activity, team, currentUser, updateActivity, deleteActivity, assignActivityAsTask } = useData();
  const matter = entry.matterId ? matters[entry.matterId] : null;
  const isTask = entry.kind === 'task';
  const isEmail = entry.kind === 'email';
  const due = isTask ? urgency(entry.dueDate) : null;

  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.body || '');
  const menuRef = useRef(null);

  // Promotion form state. Defaults to you and the next business day, because
  // the overwhelmingly common case is "I am writing this down so I do it", and
  // a default you have to clear beats a blank you have to remember to fill.
  const [promoting, setPromoting] = useState(false);
  const [assignTo, setAssignTo] = useState('');
  const [assignDue, setAssignDue] = useState('');

  const roster = useMemo(
    () => assigneeOptions({ team, currentUser, activity }),
    [team, currentUser, activity],
  );

  function openPromote() {
    setAssignTo(currentUser?.displayName || '');
    setAssignDue(nextBusinessDay(todayInFirmTz()));
    setPromoting(true);
  }

  function confirmPromote() {
    assignActivityAsTask(entry.id, {
      assignedTo: assignTo.trim() || UNASSIGNED,
      dueDate: assignDue || '',
    });
    setPromoting(false);
  }

  useEffect(() => {
    function onDocClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  function saveEdit() {
    updateActivity(entry.id, { body: draft });
    setEditing(false);
  }

  return (
    <article
      className={`rounded-lg border shadow-sm mb-3 ${
        entry.pinned
          ? 'bg-info-bg border-info-line border-l-4 border-l-sky-500'
          : 'bg-surface border-line'
      }`}
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div
            className={`w-9 h-9 rounded-full ${avatarColor(entry.author || 'x')} grid place-items-center text-white text-xs font-bold shrink-0`}
          >
            {(entry.author || '?').slice(0, 1).toUpperCase()}
          </div>

          <div className="flex-1 min-w-0">
            {showMatter && matter ? (
              <Link
                href={`/matters/${entry.matterId}`}
                className="block font-semibold text-accent-ink hover:underline truncate"
              >
                {matterTitle(matter)}
              </Link>
            ) : null}

            <p className="text-xs text-ink-2 mt-0.5">
              <span className="font-semibold text-ink">{entry.author}</span>{' '}
              {isTask ? 'created a task' : isEmail ? 'filed an email' : `created a ${entry.kind}`}
              {isEmail ? (
                <>
                  {' '}
                  <span className="px-1.5 py-0.5 rounded border border-line-strong text-ink-2 text-[11px]">
                    {entry.meta?.direction === 'sent' ? 'Sent' : 'Received'}
                  </span>
                </>
              ) : null}{' '}
              ·{' '}
              {new Date(entry.meta?.sentAt || entry.createdAt).toLocaleString('en-US', {
                month: 'numeric',
                day: 'numeric',
                year: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </p>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {isTask && due && due.level === 'overdue' ? (
              <span className="px-2 py-0.5 rounded-full bg-danger-solid text-white text-[11px] font-semibold">
                Overdue
              </span>
            ) : null}
            <button
              onClick={() => updateActivity(entry.id, { pinned: !entry.pinned })}
              className={`p-1.5 rounded ${
                entry.pinned ? 'text-warn-solid bg-warn-bg-2' : 'text-ink-4 hover:text-ink-2'
              }`}
              title={entry.pinned ? 'Unpin' : 'Pin'}
            >
              <Pin size={15} fill={entry.pinned ? 'currentColor' : 'none'} />
            </button>
            <div ref={menuRef} className="relative">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="p-1.5 text-ink-4 hover:text-ink-2"
                title="More"
              >
                <MoreVertical size={15} />
              </button>
              {menuOpen ? (
                <div className="absolute right-0 mt-1 w-44 bg-surface rounded-lg shadow-xl border border-line overflow-hidden z-50">
                  <button
                    onClick={() => { setDraft(entry.body || ''); setEditing(true); setMenuOpen(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-hover"
                  >
                    <Pencil size={14} className="text-ink-4" /> Edit
                  </button>
                  <button
                    onClick={() => { updateActivity(entry.id, { pinned: !entry.pinned }); setMenuOpen(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-hover"
                  >
                    <Pin size={14} className="text-ink-4" /> {entry.pinned ? 'Unpin' : 'Pin'}
                  </button>
                  <button
                    onClick={() => {
                      if (confirm('Delete this entry? This cannot be undone.')) deleteActivity(entry.id);
                      setMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-danger-ink hover:bg-danger-bg border-t border-line-soft"
                  >
                    <Trash2 size={14} /> Delete
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex items-start gap-3 mt-2.5">
          <span className={`w-7 h-7 rounded shrink-0 ${KIND_ICON_BG[entry.kind] || 'bg-ink-4'}`} />
          <div className="min-w-0 flex-1">
            {entry.mentions?.length ? (
              <span className="mr-1.5">
                {entry.mentions.map((m) => (
                  <span
                    key={m}
                    className="inline-block px-1.5 py-0.5 mr-1 rounded bg-info-bg-2 text-info-ink text-xs font-semibold"
                  >
                    @{m}
                  </span>
                ))}
              </span>
            ) : null}
            {isEmail ? (
              <EmailBody entry={entry} />
            ) : null}
            {!isEmail && entry.title && !editing ? (
              <span className="block text-sm font-semibold text-ink">{entry.title}</span>
            ) : null}
            {!isEmail && editing ? (
              <div>
                <textarea
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveEdit();
                    if (e.key === 'Escape') setEditing(false);
                  }}
                  className="input min-h-[70px]"
                />
                <div className="flex items-center gap-2 mt-1.5">
                  <button
                    onClick={saveEdit}
                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-primary text-white text-xs font-semibold"
                  >
                    <Check size={13} /> Save
                  </button>
                  <button
                    onClick={() => setEditing(false)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded border border-line-strong text-xs text-ink-2"
                  >
                    <X size={13} /> Cancel
                  </button>
                </div>
              </div>
            ) : isEmail ? null : (
              <span className="text-sm text-ink whitespace-pre-wrap break-words">{entry.body}</span>
            )}

            {/* EmailBody renders its own attachment list, with signed URLs. */}
            {!isEmail && entry.attachments?.length ? (
              <div className="mt-2 space-y-1">
                {entry.attachments.map((a, i) => (
                  <a
                    key={i}
                    href={a.url || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs text-accent-ink hover:underline"
                  >
                    <Paperclip size={12} /> {a.name}
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="px-4 py-2.5 border-t border-dashed border-line flex items-center gap-x-4 gap-y-2 flex-wrap text-sm">
        {isTask ? (
          <>
            {/*
              Editable, not printed. A task whose assignee is a label cannot be
              handed to anyone -- which is what "assign" means -- and work moves
              between people constantly. Saved on change: there is no Save
              button on any other control on this card either.
            */}
            <label className="flex items-center gap-1.5 text-ink-2">
              Assigned to
              <AssigneeSelect
                id={`assignee-${entry.id}`}
                value={entry.assignedTo === UNASSIGNED ? '' : entry.assignedTo}
                options={roster}
                onChange={(name) => updateActivity(entry.id, { assignedTo: name || UNASSIGNED })}
              />
            </label>
            <label className="flex items-center gap-1.5 text-ink-2">
              Due
              <DueDateInput
                id={`due-${entry.id}`}
                value={entry.dueDate}
                onChange={(date) => updateActivity(entry.id, { dueDate: date })}
              />
            </label>
            <button
              onClick={() => updateActivity(entry.id, { completed: !entry.completed })}
              className="flex items-center gap-1.5 px-3 py-1 rounded-full border border-line-strong text-ink-2 text-sm hover:bg-hover"
            >
              {entry.completed ? (
                <CheckCircle2 size={15} className="text-accent-ink" />
              ) : (
                <Circle size={15} />
              )}
              {entry.completed ? 'Completed' : 'Complete Task'}
            </button>
          </>
        ) : promoting ? (
          <div className="w-full space-y-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <label className="flex items-center gap-1.5 text-ink-2">
                Assign to
                <AssigneeSelect
                  id={`promote-assignee-${entry.id}`}
                  value={assignTo}
                  options={roster}
                  onChange={setAssignTo}
                />
              </label>
              <label className="flex items-center gap-1.5 text-ink-2">
                Due
                <DueDateInput
                  id={`promote-due-${entry.id}`}
                  value={assignDue}
                  onChange={setAssignDue}
                />
              </label>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={confirmPromote}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-accent-solid text-white text-xs font-semibold hover:bg-accent-solid-2"
              >
                <ListPlus size={14} /> Make it a task
              </button>
              <button
                onClick={() => setPromoting(false)}
                className="px-3 py-1.5 rounded border border-line-strong text-xs text-ink-2 hover:bg-hover"
              >
                Cancel
              </button>
              {!roster.length ? (
                <span className="text-[11px] text-warn-ink">
                  Nobody to assign to yet — staff appear here once they have signed in.
                </span>
              ) : null}
            </div>
          </div>
        ) : (
          <button
            onClick={openPromote}
            className="flex items-center gap-1.5 text-accent-ink font-semibold hover:underline"
            title="Promote this note to a task, in place"
          >
            <ListPlus size={15} /> Assign as Task
          </button>
        )}
      </div>
    </article>
  );
}
