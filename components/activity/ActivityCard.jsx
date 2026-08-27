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
 */

import Link from 'next/link';
import { Pin, MoreVertical, CheckCircle2, Circle, ListPlus, Paperclip } from 'lucide-react';
import { fmt, urgency } from '@/lib/domain/dates';
import { matterTitle, avatarColor } from '@/lib/domain/matter';
import { useData } from '@/lib/data/DataProvider';

const KIND_ICON_BG = {
  note: 'bg-amber-400',
  task: 'bg-teal-500',
  call: 'bg-sky-500',
  text: 'bg-violet-500',
  email: 'bg-indigo-500',
  fax: 'bg-slate-500',
  system: 'bg-slate-300',
};

export default function ActivityCard({ entry, showMatter = true }) {
  const { matters, updateActivity, assignActivityAsTask } = useData();
  const matter = entry.matterId ? matters[entry.matterId] : null;
  const isTask = entry.kind === 'task';
  const due = isTask ? urgency(entry.dueDate) : null;

  return (
    <article
      className={`rounded-lg border shadow-sm mb-3 ${
        entry.pinned
          ? 'bg-sky-50 border-sky-200 border-l-4 border-l-sky-500'
          : 'bg-white border-slate-200'
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
                className="block font-semibold text-teal-700 hover:underline truncate"
              >
                {matterTitle(matter)}
              </Link>
            ) : null}

            <p className="text-xs text-slate-600 mt-0.5">
              <span className="font-semibold text-slate-800">{entry.author}</span>{' '}
              {isTask ? 'created a task' : `created a ${entry.kind}`} ·{' '}
              {new Date(entry.createdAt).toLocaleString('en-US', {
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
              <span className="px-2 py-0.5 rounded-full bg-red-600 text-white text-[11px] font-semibold">
                Overdue
              </span>
            ) : null}
            <button
              onClick={() => updateActivity(entry.id, { pinned: !entry.pinned })}
              className={`p-1.5 rounded ${
                entry.pinned ? 'text-amber-500 bg-amber-100' : 'text-slate-300 hover:text-slate-600'
              }`}
              title={entry.pinned ? 'Unpin' : 'Pin'}
            >
              <Pin size={15} fill={entry.pinned ? 'currentColor' : 'none'} />
            </button>
            <button className="p-1.5 text-slate-300 hover:text-slate-600" title="More">
              <MoreVertical size={15} />
            </button>
          </div>
        </div>

        <div className="flex items-start gap-3 mt-2.5">
          <span className={`w-7 h-7 rounded shrink-0 ${KIND_ICON_BG[entry.kind] || 'bg-slate-400'}`} />
          <div className="min-w-0 flex-1">
            {entry.mentions?.length ? (
              <span className="mr-1.5">
                {entry.mentions.map((m) => (
                  <span
                    key={m}
                    className="inline-block px-1.5 py-0.5 mr-1 rounded bg-sky-100 text-sky-800 text-xs font-semibold"
                  >
                    @{m}
                  </span>
                ))}
              </span>
            ) : null}
            <span className="text-sm text-slate-800 whitespace-pre-wrap break-words">{entry.body}</span>

            {entry.attachments?.length ? (
              <div className="mt-2 space-y-1">
                {entry.attachments.map((a, i) => (
                  <a
                    key={i}
                    href={a.url || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs text-teal-700 hover:underline"
                  >
                    <Paperclip size={12} /> {a.name}
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="px-4 py-2.5 border-t border-dashed border-slate-200 flex items-center gap-4 flex-wrap text-sm">
        {isTask ? (
          <>
            <span className="text-slate-600">
              Assigned to{' '}
              <span className="font-semibold text-slate-900">{entry.assignedTo || 'Unassigned'}</span>
            </span>
            <span className="text-slate-600">
              Due <span className="font-semibold text-slate-900">{fmt(entry.dueDate)}</span>
            </span>
            <button
              onClick={() => updateActivity(entry.id, { completed: !entry.completed })}
              className="flex items-center gap-1.5 px-3 py-1 rounded-full border border-slate-300 text-slate-700 text-sm hover:bg-slate-50"
            >
              {entry.completed ? (
                <CheckCircle2 size={15} className="text-teal-600" />
              ) : (
                <Circle size={15} />
              )}
              {entry.completed ? 'Completed' : 'Complete Task'}
            </button>
          </>
        ) : (
          <button
            onClick={() => assignActivityAsTask(entry.id, { assignedTo: 'Unassigned', dueDate: '' })}
            className="flex items-center gap-1.5 text-teal-700 font-semibold hover:underline"
            title="Promote this note to a task, in place"
          >
            <ListPlus size={15} /> Assign as Task
          </button>
        )}
      </div>
    </article>
  );
}
