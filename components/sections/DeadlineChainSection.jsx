'use client';

/**
 * The Deadline Chain for one matter.
 *
 * Every row shows its citation verbatim -- that text is the malpractice
 * guardrail, and it is read from CHAIN_RULES rather than copied onto rows so it
 * cannot drift.
 *
 * Two things the prototype could not do:
 *   - EDIT a computed deadline. `manualOverride` was read in three places and
 *     set by no UI, so an attorney who disagreed with a computed date had no
 *     recourse and would stop trusting the list.
 *   - See that a date lands on a weekend or holiday. It warns and offers a move;
 *     it never adjusts silently.
 */

import { useState } from 'react';
import { AlertTriangle, RotateCcw, CheckCircle2, Circle, CalendarClock } from 'lucide-react';
import { fmt, urgency, nextBusinessDay, checkBadDate } from '@/lib/domain/dates';
import { useData } from '@/lib/data/DataProvider';
import { useMatter } from '@/lib/data/DataProvider';

const LEVEL_STYLES = {
  overdue: 'bg-red-50 text-red-700 border-red-200',
  critical: 'bg-orange-50 text-orange-700 border-orange-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  ok: 'bg-slate-50 text-slate-600 border-slate-200',
  unknown: 'bg-slate-100 text-slate-500 border-slate-300',
};

function DueBadge({ date }) {
  const { level, days } = urgency(date);
  const label =
    level === 'unknown'
      ? 'no date'
      : days < 0
        ? `${Math.abs(days)}d overdue`
        : days === 0
          ? 'today'
          : `in ${days}d`;
  return (
    <span className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${LEVEL_STYLES[level]}`}>
      {label}
    </span>
  );
}

export default function DeadlineChainSection({ matterId }) {
  const { tasks: matterTasks } = useMatter(matterId);
  const { updateTask, setTaskComplete, clearTaskOverride } = useData();
  const [editing, setEditing] = useState(null);

  const auto = matterTasks
    .filter((t) => t.source === 'auto')
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
  const manual = matterTasks.filter((t) => t.source !== 'auto');

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="px-5 py-3 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900">Generated Deadlines</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Computed from matter data. Never a source of truth for a real deadline — confirm every
            date with the attorney.
          </p>
        </div>

        {auto.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-400">
            No deadlines yet. Set an SOL, trial date, or DCO — or mark a checklist item done
            <em> with a date</em>.
          </p>
        ) : (
          <div className="divide-y divide-slate-50">
            {auto.map((t) => {
              const bad = checkBadDate(t.dueDate);
              return (
                <div key={t.id} className="px-5 py-3">
                  <div className="flex items-start gap-3 flex-wrap">
                    <button onClick={() => setTaskComplete(t.id, !t.completed)} className="mt-0.5 shrink-0">
                      {t.completed ? (
                        <CheckCircle2 size={19} className="text-teal-600" />
                      ) : (
                        <Circle size={19} className="text-slate-300 hover:text-slate-400" />
                      )}
                    </button>

                    <div className="flex-1 min-w-[200px]">
                      <p className={`text-sm font-semibold ${t.completed ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
                        {t.title}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">{t.note}</p>

                      {bad ? (
                        <p className="flex items-center gap-1.5 text-xs text-amber-700 mt-1.5">
                          <AlertTriangle size={13} />
                          Falls on a {bad}.
                          <button
                            onClick={() => updateTask(t.id, { dueDate: nextBusinessDay(t.dueDate) })}
                            className="underline font-semibold hover:text-amber-900"
                          >
                            Move to {fmt(nextBusinessDay(t.dueDate))}
                          </button>
                        </p>
                      ) : null}

                      {t.manualOverride ? (
                        <p className="flex items-center gap-1.5 text-xs text-slate-500 mt-1.5">
                          <CalendarClock size={13} />
                          Overridden. Computed date was {fmt(t.autoDueDate)}.
                          <button
                            onClick={() => clearTaskOverride(t.id)}
                            className="underline font-semibold hover:text-slate-800 inline-flex items-center gap-1"
                          >
                            <RotateCcw size={11} /> Restore
                          </button>
                        </p>
                      ) : null}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <DueBadge date={t.dueDate} />
                      {editing === t.id ? (
                        <input
                          type="date"
                          autoFocus
                          className="input w-[145px]"
                          value={t.dueDate || ''}
                          onChange={(e) => updateTask(t.id, { dueDate: e.target.value })}
                          onBlur={() => setEditing(null)}
                        />
                      ) : (
                        <button
                          onClick={() => setEditing(t.id)}
                          className="text-sm font-medium text-slate-700 hover:text-teal-700 hover:underline w-[110px] text-right"
                          title="Edit this deadline"
                        >
                          {fmt(t.dueDate)}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {manual.length > 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="px-5 py-3 border-b border-slate-100">
            <h2 className="font-semibold text-slate-900">Manual Tasks</h2>
          </div>
          <div className="divide-y divide-slate-50">
            {manual.map((t) => (
              <div key={t.id} className="px-5 py-3 flex items-center gap-3">
                <button onClick={() => setTaskComplete(t.id, !t.completed)} className="shrink-0">
                  {t.completed ? (
                    <CheckCircle2 size={19} className="text-teal-600" />
                  ) : (
                    <Circle size={19} className="text-slate-300" />
                  )}
                </button>
                <span className={`flex-1 text-sm ${t.completed ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
                  {t.title}
                </span>
                <DueBadge date={t.dueDate} />
                <span className="text-sm text-slate-600 w-[110px] text-right">{fmt(t.dueDate)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
