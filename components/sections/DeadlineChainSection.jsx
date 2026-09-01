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
import { urgencyBadgeClass } from '@/lib/ui/tone';

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
    <span className={urgencyBadgeClass(level)}>
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
      <div className="bg-surface rounded-xl border border-line shadow-sm">
        <div className="px-5 py-3 border-b border-line-soft">
          <h2 className="font-semibold text-ink">Generated Deadlines</h2>
          <p className="text-xs text-ink-3 mt-0.5">
            Computed from matter data. Never a source of truth for a real deadline — confirm every
            date with the attorney.
          </p>
        </div>

        {auto.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-ink-4">
            No deadlines yet. Set an SOL, trial date, or DCO — or mark a checklist item done
            <em> with a date</em>.
          </p>
        ) : (
          <div className="divide-y divide-line-soft">
            {auto.map((t) => {
              const bad = checkBadDate(t.dueDate);
              return (
                <div key={t.id} className="px-5 py-3">
                  <div className="flex items-start gap-3 flex-wrap">
                    <button onClick={() => setTaskComplete(t.id, !t.completed)} className="mt-0.5 shrink-0">
                      {t.completed ? (
                        <CheckCircle2 size={19} className="text-accent-ink" />
                      ) : (
                        <Circle size={19} className="text-ink-4 hover:text-ink-3" />
                      )}
                    </button>

                    <div className="flex-1 min-w-[200px]">
                      <p className={`text-sm font-semibold ${t.completed ? 'text-ink-4 line-through' : 'text-ink'}`}>
                        {t.title}
                      </p>
                      <p className="text-xs text-ink-3 mt-0.5">{t.note}</p>

                      {bad ? (
                        <p className="flex items-center gap-1.5 text-xs text-warn-ink mt-1.5">
                          <AlertTriangle size={13} />
                          Falls on a {bad}.
                          <button
                            onClick={() => updateTask(t.id, { dueDate: nextBusinessDay(t.dueDate) })}
                            className="underline font-semibold hover:text-warn-ink-strong"
                          >
                            Move to {fmt(nextBusinessDay(t.dueDate))}
                          </button>
                        </p>
                      ) : null}

                      {t.manualOverride ? (
                        <p className="flex items-center gap-1.5 text-xs text-ink-3 mt-1.5">
                          <CalendarClock size={13} />
                          Overridden. Computed date was {fmt(t.autoDueDate)}.
                          <button
                            onClick={() => clearTaskOverride(t.id)}
                            className="underline font-semibold hover:text-ink inline-flex items-center gap-1"
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
                          className="text-sm font-medium text-ink-2 hover:text-accent-ink hover:underline w-[110px] text-right"
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
        <div className="bg-surface rounded-xl border border-line shadow-sm">
          <div className="px-5 py-3 border-b border-line-soft">
            <h2 className="font-semibold text-ink">Manual Tasks</h2>
          </div>
          <div className="divide-y divide-line-soft">
            {manual.map((t) => (
              <div key={t.id} className="px-5 py-3 flex items-center gap-3">
                <button onClick={() => setTaskComplete(t.id, !t.completed)} className="shrink-0">
                  {t.completed ? (
                    <CheckCircle2 size={19} className="text-accent-ink" />
                  ) : (
                    <Circle size={19} className="text-ink-4" />
                  )}
                </button>
                <span className={`flex-1 text-sm ${t.completed ? 'text-ink-4 line-through' : 'text-ink'}`}>
                  {t.title}
                </span>
                <DueBadge date={t.dueDate} />
                <span className="text-sm text-ink-2 w-[110px] text-right">{fmt(t.dueDate)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
