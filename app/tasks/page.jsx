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
import { CalendarDays, AlertCircle, ListChecks, X, CheckCircle2, Circle } from 'lucide-react';
import RailLayout, { RailItem } from '@/components/shell/RailLayout';
import { useData } from '@/lib/data/DataProvider';
import { matterTitle } from '@/lib/domain/matter';
import { fmt, urgency, todayInFirmTz, daysFromToday } from '@/lib/domain/dates';

const BUCKETS = [
  { key: 'all', label: 'All Due Dates', icon: ListChecks, test: () => true },
  { key: 'overdue', label: 'On or Before Today', icon: AlertCircle, test: (d) => d !== null && d <= 0 },
  { key: 'today', label: 'Due Today', icon: CalendarDays, test: (d) => d === 0 },
  { key: 'week', label: 'Next 7 Days', icon: CalendarDays, test: (d) => d !== null && d >= 0 && d <= 7 },
  { key: 'month', label: 'Next 30 Days', icon: CalendarDays, test: (d) => d !== null && d >= 0 && d <= 30 },
];

const PAGE_SIZE = 25;

const LEVEL = {
  overdue: 'bg-red-50 text-red-700 border-red-200',
  critical: 'bg-orange-50 text-orange-700 border-orange-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  ok: 'bg-slate-50 text-slate-600 border-slate-200',
  unknown: 'bg-slate-100 text-slate-500 border-slate-300',
};

export default function TasksPage() {
  const { tasks, matters, loaded, setTaskComplete, bulkSetComplete } = useData();
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
          className="bg-white border border-slate-300 rounded px-3 py-1.5"
        >
          <option value="">All Assignees</option>
          {assignees.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>

        <button
          onClick={() => setShowCompleted((v) => !v)}
          className={`px-3 py-1.5 rounded-full font-semibold ${
            showCompleted ? 'bg-slate-900 text-white' : 'bg-white border border-slate-300 text-slate-700'
          }`}
        >
          {showCompleted ? 'Showing completed' : 'Incomplete'}
        </button>

        {selected.size > 0 ? (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-slate-600">{selected.size} selected</span>
            <button
              onClick={() => { bulkSetComplete([...selected], true); setSelected(new Set()); }}
              className="px-3 py-1.5 rounded bg-teal-600 text-white font-semibold"
            >
              Complete
            </button>
            <button onClick={() => setSelected(new Set())} className="p-1.5 text-slate-400 hover:text-slate-700">
              <X size={16} />
            </button>
          </div>
        ) : null}
      </div>

      {!loaded ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : pageRows.length === 0 ? (
        <p className="py-12 text-center text-sm text-slate-400">
          Nothing here. Deadlines appear automatically once a matter has an SOL, a trial date, or a
          dated checklist item.
        </p>
      ) : (
        <>
          {pageRows.map((t) => {
            const { level, days } = urgency(t.dueDate, { today });
            const matter = t.matterId ? matters[t.matterId] : null;
            return (
              <div key={t.id} className="bg-white rounded-lg border border-slate-200 shadow-sm mb-2.5 p-4">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selected.has(t.id)}
                    onChange={() => toggle(t.id)}
                    className="mt-1 shrink-0"
                  />
                  <button onClick={() => setTaskComplete(t.id, !t.completed)} className="mt-0.5 shrink-0">
                    {t.completed ? (
                      <CheckCircle2 size={19} className="text-teal-600" />
                    ) : (
                      <Circle size={19} className="text-slate-300 hover:text-slate-400" />
                    )}
                  </button>

                  <div className="flex-1 min-w-0">
                    {matter ? (
                      <Link href={`/matters/${t.matterId}`} className="text-sm font-semibold text-teal-700 hover:underline">
                        {matterTitle(matter)}
                      </Link>
                    ) : null}
                    <p className={`text-sm mt-0.5 ${t.completed ? 'text-slate-400 line-through' : 'text-slate-900 font-medium'}`}>
                      {t.title}
                    </p>
                    {t.note ? <p className="text-xs text-slate-500 mt-0.5">{t.note}</p> : null}
                    <p className="text-xs text-slate-500 mt-1.5">
                      Assigned to <span className="font-semibold text-slate-700">{t.assignedTo}</span>
                      {t.manualOverride ? ' · manually overridden' : ''}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${LEVEL[level]}`}>
                      {level === 'unknown'
                        ? 'no date'
                        : days < 0
                          ? `${Math.abs(days)}d overdue`
                          : days === 0
                            ? 'today'
                            : `in ${days}d`}
                    </span>
                    <span className="text-sm text-slate-700 w-[100px] text-right">{fmt(t.dueDate)}</span>
                  </div>
                </div>
              </div>
            );
          })}

          {pages > 1 ? (
            <div className="flex items-center justify-between mt-4 text-sm">
              <span className="text-slate-500">
                {page * PAGE_SIZE + 1} to {Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
              </span>
              <div className="flex items-center gap-2">
                <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}
                  className="px-2.5 py-1 rounded border border-slate-300 bg-white disabled:opacity-40">Prev</button>
                <span className="text-slate-600">Page {page + 1} of {pages}</span>
                <button disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}
                  className="px-2.5 py-1 rounded border border-slate-300 bg-white disabled:opacity-40">Next</button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </RailLayout>
  );
}
