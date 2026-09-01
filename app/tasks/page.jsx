'use client';

/**
 * The global Tasks list.
 *
 * Left rail is due-date buckets, as Filevine has it. Two things learned from the
 * real screenshot drive the design:
 *   - 117 open items for one person, overdue by months. So: pagination, bulk
 *     complete, and narrow default filters.
 *   - Overdue is the NORMAL state, not an alarm. Calm sortable badges, no
 *     permanently-red panel that everyone learns to ignore.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, AlertCircle, ListChecks, X, CheckCircle2, Circle, Plus, Trash2 } from 'lucide-react';
import AddTaskDialog from '@/components/tasks/AddTaskDialog';
import RailLayout, { RailItem } from '@/components/shell/RailLayout';
import { useData } from '@/lib/data/DataProvider';
import { matterTitle } from '@/lib/domain/matter';
import { fmt, urgency, todayInFirmTz, daysFromToday } from '@/lib/domain/dates';
import { urgencyBadgeClass } from '@/lib/ui/tone';

const BUCKETS = [
  { key: 'all', label: 'All Due Dates', icon: ListChecks, test: () => true },
  { key: 'overdue', label: 'On or Before Today', icon: AlertCircle, test: (d) => d !== null && d <= 0 },
  { key: 'today', label: 'Due Today', icon: CalendarDays, test: (d) => d === 0 },
  { key: 'week', label: 'Next 7 Days', icon: CalendarDays, test: (d) => d !== null && d >= 0 && d <= 7 },
  { key: 'month', label: 'Next 30 Days', icon: CalendarDays, test: (d) => d !== null && d >= 0 && d <= 30 },
];

const PAGE_SIZE = 25;

export default function TasksPage() {
  const { tasks, matters, loaded, setTaskComplete, bulkSetComplete, deleteTask } = useData();
  const [adding, setAdding] = useState(false);
  const [bucket, setBucket] = useState('all');
  const [showCompleted, setShowCompleted] = useState(false);
  const [assignee, setAssignee] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [page, setPage] = useState(0);
  const today = todayInFirmTz();

  const all = useMemo(() => Object.values(tasks), [tasks]);

  const assignees = useMemo(
    () => [...new Set(all.map((t) => t.assignedTo).filter(Boolean))].sort(),
    [all]
  );

  const counts = useMemo(() => {
    const open = all.filter((t) => !t.completed);
    const out = {};
    for (const b of BUCKETS) {
      out[b.key] = open.filter((t) => b.test(daysFromToday(t.dueDate, today))).length;
    }
    return out;
  }, [all, today]);

  const filtered = useMemo(() => {
    const b = BUCKETS.find((x) => x.key === bucket) || BUCKETS[0];
    return all
      .filter((t) => (showCompleted ? true : !t.completed))
      .filter((t) => (assignee ? t.assignedTo === assignee : true))
      .filter((t) => b.test(daysFromToday(t.dueDate, today)))
      .sort((a, b2) => String(a.dueDate || '9999').localeCompare(String(b2.dueDate || '9999')));
  }, [all, bucket, showCompleted, assignee, today]);

  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  function toggle(id) {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  const rail = (
    <>
      {BUCKETS.map((b) => (
        <RailItem
          key={b.key}
          icon={b.icon}
          label={b.label}
          count={counts[b.key]}
          active={bucket === b.key}
          onClick={() => { setBucket(b.key); setPage(0); }}
        />
      ))}
    </>
  );

  return (
    <RailLayout title="Tasks" count={filtered.length} rail={rail} wide>
      <div className="flex items-center gap-3 flex-wrap mb-4 text-sm">
        <select
          value={assignee}
          onChange={(e) => { setAssignee(e.target.value); setPage(0); }}
          className="bg-surface border border-line-strong rounded px-3 py-1.5"
        >
          <option value="">All Assignees</option>
          {assignees.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>

        <button
          onClick={() => setShowCompleted((v) => !v)}
          className={`px-3 py-1.5 rounded-full font-semibold ${
            showCompleted ? 'bg-primary text-white' : 'bg-surface border border-line-strong text-ink-2'
          }`}
        >
          {showCompleted ? 'Showing completed' : 'Incomplete'}
        </button>

        {selected.size > 0 ? (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-ink-2">{selected.size} selected</span>
            <button
              onClick={() => { bulkSetComplete([...selected], true); setSelected(new Set()); }}
              className="px-3 py-1.5 rounded bg-accent-solid text-white font-semibold"
            >
              Complete
            </button>
            <button
              onClick={() => {
                // Only manual tasks can be deleted. An auto task is regenerated
                // from matter data, so deleting one would just make it reappear
                // -- confusing, and it would look like the delete failed.
                const manual = [...selected].filter((id) => tasks[id]?.source !== 'auto');
                const autoCount = selected.size - manual.length;
                const msg = autoCount
                  ? `Delete ${manual.length} task(s)? ${autoCount} generated deadline(s) will be skipped — those come from case data.`
                  : `Delete ${manual.length} task(s)?`;
                if (manual.length && confirm(msg)) manual.forEach((id) => deleteTask(id));
                setSelected(new Set());
              }}
              className="flex items-center gap-1 px-3 py-1.5 rounded border border-danger-line text-danger-ink font-semibold hover:bg-danger-bg"
            >
              <Trash2 size={14} /> Delete
            </button>
            <button onClick={() => setSelected(new Set())} className="p-1.5 text-ink-4 hover:text-ink-2">
              <X size={16} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="ml-auto flex items-center gap-1.5 px-4 py-1.5 rounded bg-accent-solid text-white font-semibold hover:bg-accent-solid-2"
          >
            <Plus size={15} /> Add Task
          </button>
        )}
      </div>

      <AddTaskDialog open={adding} onClose={() => setAdding(false)} />

      {!loaded ? (
        <p className="text-sm text-ink-3">Loading…</p>
      ) : pageRows.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm text-ink-4">
            Nothing here. Deadlines appear automatically once a matter has an SOL, a trial date, or
            a dated checklist item.
          </p>
          <button
            onClick={() => setAdding(true)}
            className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-line-strong bg-surface text-sm font-semibold text-ink-2 hover:bg-hover"
          >
            <Plus size={15} /> Add a task
          </button>
        </div>
      ) : (
        <>
          {pageRows.map((t) => {
            const { level, days } = urgency(t.dueDate, { today });
            const matter = t.matterId ? matters[t.matterId] : null;
            return (
              <div key={t.id} className="bg-surface rounded-lg border border-line shadow-sm mb-2.5 p-4">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selected.has(t.id)}
                    onChange={() => toggle(t.id)}
                    className="mt-1 shrink-0"
                  />
                  <button onClick={() => setTaskComplete(t.id, !t.completed)} className="mt-0.5 shrink-0">
                    {t.completed ? (
                      <CheckCircle2 size={19} className="text-accent-ink" />
                    ) : (
                      <Circle size={19} className="text-ink-4 hover:text-ink-3" />
                    )}
                  </button>

                  <div className="flex-1 min-w-0">
                    {matter ? (
                      <Link href={`/matters/${t.matterId}`} className="text-sm font-semibold text-accent-ink hover:underline">
                        {matterTitle(matter)}
                      </Link>
                    ) : null}
                    <p className={`text-sm mt-0.5 ${t.completed ? 'text-ink-4 line-through' : 'text-ink font-medium'}`}>
                      {t.title}
                    </p>
                    {t.note ? <p className="text-xs text-ink-3 mt-0.5">{t.note}</p> : null}
                    <p className="text-xs text-ink-3 mt-1.5">
                      Assigned to <span className="font-semibold text-ink-2">{t.assignedTo}</span>
                      {t.manualOverride ? ' · manually overridden' : ''}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className={urgencyBadgeClass(level)}>
                      {level === 'unknown'
                        ? 'no date'
                        : days < 0
                          ? `${Math.abs(days)}d overdue`
                          : days === 0
                            ? 'today'
                            : `in ${days}d`}
                    </span>
                    <span className="text-sm text-ink-2 w-[100px] text-right">{fmt(t.dueDate)}</span>
                  </div>
                </div>
              </div>
            );
          })}

          {pages > 1 ? (
            <div className="flex items-center justify-between mt-4 text-sm">
              <span className="text-ink-3">
                {page * PAGE_SIZE + 1} to {Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
              </span>
              <div className="flex items-center gap-2">
                <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}
                  className="px-2.5 py-1 rounded border border-line-strong bg-surface disabled:opacity-40">Prev</button>
                <span className="text-ink-2">Page {page + 1} of {pages}</span>
                <button disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}
                  className="px-2.5 py-1 rounded border border-line-strong bg-surface disabled:opacity-40">Next</button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </RailLayout>
  );
}
