'use client';

/**
 * Dashboard — the home route.
 *
 * Filevine has no dashboard. The firm's requirements note asks for one by name:
 * "a dashboard with active cases, overdue tasks, inactive cases, and trial within
 * 30/60/90/120 days with email notifications." Every panel below maps to a clause
 * of that sentence. See docs/DECISIONS.md.
 *
 * Deliberately NOT an alarm surface. The real Filevine Tasks screen showed 117
 * open items for one person, overdue by months — so overdue is the normal working
 * state here, and a permanently-red panel would just teach everyone to ignore it.
 */

import { useMemo } from 'react';
import Link from 'next/link';
import {
  FolderOpen, TrendingUp, AlertCircle, Clock, CalendarClock, ArrowRight,
} from 'lucide-react';
import { useData } from '@/lib/data/DataProvider';
import {
  isActive, isStale, daysSinceActivity, matterTitle, trialCountdown, TRIAL_TIERS, STALE_DAYS,
} from '@/lib/domain/matter';
import { todayInFirmTz, daysFromToday, fmt, urgency } from '@/lib/domain/dates';

const TIER_STYLES = {
  30: 'border-red-200 bg-red-50 text-red-800',
  60: 'border-orange-200 bg-orange-50 text-orange-800',
  90: 'border-amber-200 bg-amber-50 text-amber-800',
  120: 'border-slate-200 bg-slate-50 text-slate-700',
};

export default function DashboardPage() {
  const { matters, tasks, loaded } = useData();
  const today = todayInFirmTz();

  const stats = useMemo(() => {
    const entries = Object.entries(matters);
    const active = entries.filter(([, m]) => isActive(m));
    const stale = active.filter(([, m]) => isStale(m, today));

    const thisMonth = active.filter(([, m]) => {
      const od = m.values?.openDate || '';
      return od.slice(0, 7) === today.slice(0, 7);
    });

    const openTasks = Object.values(tasks).filter((t) => !t.completed);
    const overdue = openTasks
      .filter((t) => {
        const d = daysFromToday(t.dueDate, today);
        return d !== null && d < 0;
      })
      .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));

    const upcoming = openTasks
      .filter((t) => {
        const d = daysFromToday(t.dueDate, today);
        return d !== null && d >= 0 && d <= 90;
      })
      .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));

    // Missing high-stakes dates. The prototype rendered these as calm green
    // badges because NaN failed every comparison; they are surfaced instead.
    const missingDates = active.filter(([, m]) => {
      const v = m.values || {};
      return !v.sol || !v.trialDate;
    });

    return {
      activeCount: active.length,
      openedThisMonth: thisMonth.length,
      overdue,
      upcoming,
      stale,
      missingDates,
      countdown: trialCountdown(matters, today),
    };
  }, [matters, tasks, today]);

  if (!loaded) return <p className="p-8 text-sm text-slate-500">Loading…</p>;

  const totalTrial = TRIAL_TIERS.reduce((n, t) => n + stats.countdown[t].length, 0);

  return (
    <div className="p-4 sm:p-6 max-w-7xl">
      <div className="flex items-baseline gap-3 mb-5 flex-wrap">
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <span className="text-sm text-slate-500">
          {new Date(`${today}T12:00:00Z`).toLocaleDateString('en-US', {
            timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
          })}
        </span>
      </div>

      {/* The five cards the requirements note asks for. */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5 mb-6">
        <Card icon={FolderOpen} label="Active Cases" value={stats.activeCount} href="/projects" />
        <Card icon={TrendingUp} label="Opened This Month" value={stats.openedThisMonth} />
        <Card icon={AlertCircle} label="Overdue Tasks" value={stats.overdue.length} href="/tasks" accent={stats.overdue.length > 0} />
        <Card icon={Clock} label={`Inactive ${STALE_DAYS}+ Days`} value={stats.stale.length} accent={stats.stale.length > 0} />
        <Card icon={CalendarClock} label="Trial Within 120 Days" value={totalTrial} accent={stats.countdown[30].length > 0} />
      </div>

      {/* Trial countdown, 30/60/90/120 as specified. */}
      <Panel title="Trial Countdown" subtitle="30 / 60 / 90 / 120 days">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 p-4">
          {TRIAL_TIERS.map((tier) => (
            <div key={tier} className={`rounded-lg border p-3 ${TIER_STYLES[tier]}`}>
              <p className="text-[11px] font-bold uppercase tracking-wide mb-2">Within {tier} days</p>
              {stats.countdown[tier].length === 0 ? (
                <p className="text-xs opacity-60">None</p>
              ) : (
                <ul className="space-y-1.5">
                  {stats.countdown[tier].map(({ id, matter, days }) => (
                    <li key={id}>
                      <Link href={`/matters/${id}`} className="text-xs font-medium hover:underline block truncate">
                        {matterTitle(matter)}
                      </Link>
                      <span className="text-[11px] opacity-70">
                        {fmt(matter.values?.trialDate)} · {days}d
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Overdue Tasks" count={stats.overdue.length} href="/tasks">
          <TaskList rows={stats.overdue.slice(0, 8)} matters={matters} today={today} empty="Nothing overdue." />
        </Panel>

        <Panel title="Upcoming Deadlines" subtitle="Next 90 days" count={stats.upcoming.length} href="/tasks">
          <TaskList rows={stats.upcoming.slice(0, 8)} matters={matters} today={today} empty="Nothing due in the next 90 days." />
        </Panel>

        <Panel title="Cases Needing Attention" subtitle={`No activity in ${STALE_DAYS}+ days`} count={stats.stale.length}>
          {stats.stale.length === 0 ? (
            <Empty>Every active case has recent activity.</Empty>
          ) : (
            <ul className="divide-y divide-slate-50">
              {stats.stale.slice(0, 8).map(([id, m]) => (
                <li key={id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                  <Link href={`/matters/${id}`} className="text-sm font-medium text-teal-700 hover:underline truncate">
                    {matterTitle(m)}
                  </Link>
                  <span className="text-xs text-slate-500 shrink-0">
                    {daysSinceActivity(m, today)}d ago
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Missing Key Dates"
          subtitle="Active cases with no SOL or no trial date"
          count={stats.missingDates.length}
        >
          {stats.missingDates.length === 0 ? (
            <Empty>Every active case has an SOL and a trial date.</Empty>
          ) : (
            <ul className="divide-y divide-slate-50">
              {stats.missingDates.slice(0, 8).map(([id, m]) => {
                const v = m.values || {};
                const missing = [!v.sol && 'SOL', !v.trialDate && 'trial date'].filter(Boolean);
                return (
                  <li key={id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                    <Link href={`/matters/${id}`} className="text-sm font-medium text-teal-700 hover:underline truncate">
                      {matterTitle(m)}
                    </Link>
                    <span className="text-xs text-amber-700 font-medium shrink-0">
                      no {missing.join(', no ')}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      <p className="mt-6 text-xs text-slate-400 max-w-2xl">
        Every generated deadline is computed from matter data and must be confirmed with the
        attorney. This system is not the sole source of truth for any real deadline.
      </p>
    </div>
  );
}

function Card({ icon: Icon, label, value, href, accent }) {
  const inner = (
    <div
      className={`bg-white rounded-xl border shadow-sm p-4 h-full transition ${
        accent ? 'border-amber-200' : 'border-slate-200'
      } ${href ? 'hover:border-teal-300' : ''}`}
    >
      <div className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide mb-1.5 ${
        accent ? 'text-amber-600' : 'text-slate-400'
      }`}>
        <Icon size={14} /> <span className="truncate">{label}</span>
      </div>
      <div className="text-3xl font-bold text-slate-900">{value}</div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function Panel({ title, subtitle, count, href, children }) {
  return (
    <section className="bg-white rounded-xl border border-slate-200 shadow-sm mb-4 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
        <div className="min-w-0">
          <h2 className="font-semibold text-slate-900 truncate">{title}</h2>
          {subtitle ? <p className="text-xs text-slate-500">{subtitle}</p> : null}
        </div>
        <div className="flex-1" />
        {count !== undefined ? <span className="text-sm text-slate-500 shrink-0">{count}</span> : null}
        {href ? (
          <Link href={href} className="text-teal-700 hover:text-teal-900 shrink-0" title="See all">
            <ArrowRight size={16} />
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }) {
  return <p className="px-4 py-8 text-center text-sm text-slate-400">{children}</p>;
}

function TaskList({ rows, matters, today, empty }) {
  if (rows.length === 0) return <Empty>{empty}</Empty>;
  return (
    <ul className="divide-y divide-slate-50">
      {rows.map((t) => {
        const { level, days } = urgency(t.dueDate, { today });
        const matter = t.matterId ? matters[t.matterId] : null;
        return (
          <li key={t.id} className="px-4 py-2.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {matter ? (
                  <Link href={`/matters/${t.matterId}`} className="text-xs text-teal-700 hover:underline block truncate">
                    {matterTitle(matter)}
                  </Link>
                ) : null}
                <p className="text-sm font-medium text-slate-900 truncate">{t.title}</p>
              </div>
              <span className={`text-xs font-semibold shrink-0 ${
                level === 'overdue' ? 'text-red-600' : level === 'critical' ? 'text-orange-600' : 'text-slate-500'
              }`}>
                {days === null ? '—' : days < 0 ? `${Math.abs(days)}d over` : `${days}d`}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
