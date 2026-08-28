'use client';

/**
 * The Calendar — deadlines and tasks on a month grid.
 *
 * Nothing here invents data. Every square is drawn from dates that already
 * drive the Tasks list and the Deadline Chain, so the calendar cannot disagree
 * with them; it is a second view of one set of facts, not a second copy.
 *
 * Grid arithmetic lives in lib/domain/calendar.js and is tested in three
 * timezones. A calendar assembled with `new Date(y, m, d)` renders a different
 * layout depending on the viewer's machine, and somebody eventually reads a
 * trial date off the wrong row.
 *
 * NOT built yet, and deliberately not faked: Google/Outlook sync. Filevine has
 * it, the firm will want it, and it needs OAuth per user plus a sync loop with
 * real conflict handling. A button that looked like it synced would be worse
 * than the note at the bottom of the filter rail saying it does not.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, CalendarDays, AlertCircle } from 'lucide-react';
import RailLayout, { RailItem } from '@/components/shell/RailLayout';
import { useData } from '@/lib/data/DataProvider';
import { matterTitle } from '@/lib/domain/matter';
import { fmt, todayInFirmTz } from '@/lib/domain/dates';
import {
  WEEKDAYS, monthOf, shiftMonth, monthLabel, monthGrid,
  groupByDate, collectEvents, MATTER_DATE_KINDS,
} from '@/lib/domain/calendar';

const TONE = {
  red: 'bg-red-100 text-red-800 border-red-200',
  purple: 'bg-purple-100 text-purple-800 border-purple-200',
  orange: 'bg-orange-100 text-orange-800 border-orange-200',
  sky: 'bg-sky-100 text-sky-800 border-sky-200',
  teal: 'bg-teal-100 text-teal-800 border-teal-200',
  slate: 'bg-slate-100 text-slate-700 border-slate-200',
};

const FILTERS = [
  { key: 'task', label: 'Tasks', tone: 'sky' },
  ...MATTER_DATE_KINDS.map((k) => ({ key: k.key, label: k.label, tone: k.tone })),
];

export default function CalendarPage() {
  const { matters, tasks, loaded } = useData();
  const today = todayInFirmTz();

  const [cursor, setCursor] = useState(() => monthOf(today));
  const [active, setActive] = useState(() => FILTERS.map((f) => f.key));
  const [selected, setSelected] = useState(null);

  const weeks = useMemo(() => monthGrid(cursor, { today }), [cursor, today]);

  const { byDate, undated } = useMemo(
    () => groupByDate(collectEvents({ matters, tasks, kinds: active })),
    [matters, tasks, active]
  );

  const counts = useMemo(() => {
    const all = collectEvents({ matters, tasks });
    const out = {};
    for (const f of FILTERS) out[f.key] = all.filter((e) => e.kind === f.key).length;
    return out;
  }, [matters, tasks]);

  function toggle(key) {
    setActive((a) => (a.includes(key) ? a.filter((k) => k !== key) : [...a, key]));
  }

  const rail = (
    <>
      <p className="px-3 pt-2 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Show
      </p>
      {FILTERS.map((f) => (
        <RailItem
          key={f.key}
          label={f.label}
          count={counts[f.key] || 0}
          active={active.includes(f.key)}
          onClick={() => toggle(f.key)}
        />
      ))}

      <div className="px-3 pt-4 mt-3 border-t border-slate-200">
        <p className="text-xs text-slate-500 leading-snug">
          Every date here comes from the same records as the Tasks list, so the two cannot
          disagree.
        </p>
        <p className="mt-2 text-xs text-slate-400 leading-snug">
          Google and Outlook sync is not built yet.
        </p>
      </div>
    </>
  );

  const dayEvents = selected ? byDate[selected] || [] : [];

  return (
    <RailLayout rail={rail}>
      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-2xl font-bold text-slate-900">{monthLabel(cursor)}</h1>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCursor((c) => shiftMonth(c, -1))}
            aria-label="Previous month"
            className="p-1.5 rounded border border-slate-300 text-slate-600 hover:bg-slate-100"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => setCursor((c) => shiftMonth(c, 1))}
            aria-label="Next month"
            className="p-1.5 rounded border border-slate-300 text-slate-600 hover:bg-slate-100"
          >
            <ChevronRight size={16} />
          </button>
          <button
            onClick={() => { setCursor(monthOf(today)); setSelected(null); }}
            className="ml-1 px-3 py-1.5 rounded border border-slate-300 text-sm text-slate-700 hover:bg-slate-100"
          >
            Today
          </button>
        </div>

        <div className="flex-1" />

        {/*
          Undated items are surfaced, not swallowed. A task with no due date
          appears on no square, and a calendar that quietly omits work is how
          something gets missed.
        */}
        {undated > 0 ? (
          <Link
            href="/tasks"
            className="flex items-center gap-1.5 text-sm text-amber-700 hover:underline"
          >
            <AlertCircle size={14} />
            {undated} item{undated === 1 ? '' : 's'} with no date — not shown
          </Link>
        ) : null}
      </div>

      {!loaded ? (
        <p className="py-16 text-center text-sm text-slate-400">Loading…</p>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
            {WEEKDAYS.map((d) => (
              <div key={d} className="px-2 py-1.5 text-xs font-semibold text-slate-500 text-center">
                {d}
              </div>
            ))}
          </div>

          {weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7 border-b border-slate-200 last:border-b-0">
              {week.map((day) => {
                const events = byDate[day.date] || [];
                const shown = events.slice(0, 3);
                return (
                  <button
                    key={day.date}
                    onClick={() => setSelected(day.date === selected ? null : day.date)}
                    className={`min-h-[6.5rem] p-1.5 text-left border-r border-slate-200 last:border-r-0 align-top transition ${
                      day.inMonth ? 'bg-white' : 'bg-slate-50/60'
                    } ${selected === day.date ? 'ring-2 ring-inset ring-teal-500' : 'hover:bg-slate-50'}`}
                  >
                    <span
                      className={`inline-grid place-items-center w-6 h-6 rounded-full text-xs font-semibold ${
                        day.isToday
                          ? 'bg-teal-600 text-white'
                          : day.inMonth
                            ? 'text-slate-700'
                            : 'text-slate-400'
                      }`}
                    >
                      {day.day}
                    </span>

                    <div className="mt-1 space-y-0.5">
                      {shown.map((e) => (
                        <span
                          key={e.id}
                          className={`block truncate px-1 py-0.5 rounded border text-[11px] leading-tight ${TONE[e.tone] || TONE.slate}`}
                        >
                          {/* Always name the case: "Order billing records" on
                              a firm-wide calendar tells you nothing on its own. */}
                          {e.title} — {clientOf(matters, e.matterId)}
                        </span>
                      ))}
                      {events.length > shown.length ? (
                        <span className="block px-1 text-[11px] text-slate-500">
                          +{events.length - shown.length} more
                        </span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {selected ? (
        <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2 mb-3">
            <CalendarDays size={16} className="text-slate-400" />
            <h2 className="font-semibold text-slate-900">{fmt(selected)}</h2>
            <span className="text-sm text-slate-500">
              {dayEvents.length} item{dayEvents.length === 1 ? '' : 's'}
            </span>
          </div>

          {dayEvents.length === 0 ? (
            <p className="text-sm text-slate-400">Nothing on this day.</p>
          ) : (
            <ul className="space-y-1.5">
              {dayEvents.map((e) => (
                <li key={e.id} className="flex items-center gap-2 text-sm">
                  <span className={`px-1.5 py-0.5 rounded border text-[11px] ${TONE[e.tone] || TONE.slate}`}>
                    {e.kind === 'task' ? 'Task' : e.title}
                  </span>
                  {e.kind === 'task' ? <span className="text-slate-800">{e.title}</span> : null}
                  {e.matterId ? (
                    <Link href={`/matters/${e.matterId}`} className="text-teal-700 hover:underline">
                      {clientOf(matters, e.matterId)}
                    </Link>
                  ) : null}
                  {e.assignedTo ? <span className="text-slate-500">· {e.assignedTo}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </RailLayout>
  );
}

function clientOf(matters, id) {
  const m = matters[id];
  return m ? matterTitle(m) : 'Unknown matter';
}
