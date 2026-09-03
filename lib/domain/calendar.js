/**
 * Month grid arithmetic for the calendar.
 *
 * Every function here works on `"YYYY-MM-DD"` strings and builds dates with
 * `Date.UTC`, for the same reason the rest of dates.js does: a calendar built
 * from `new Date(y, m, d)` renders a different grid depending on the viewer's
 * machine, and "which week is the 1st in" is exactly the sort of question that
 * silently changes answer across a timezone boundary.
 *
 * A deadline calendar that shows a different month layout in Houston and on a
 * laptop still set to Pacific is not a small bug -- somebody reads a trial date
 * off the wrong row.
 */

import { toISO, dayOfWeek, addDays, todayInFirmTz, isValidISO } from './dates.js';

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** `{ year, month }` for the month containing an ISO date. month is 1-12. */
export function monthOf(iso = todayInFirmTz()) {
  const [y, m] = String(iso).split('-').map(Number);
  return { year: y, month: m };
}

/** Step a `{year, month}` by whole months, rolling the year over. */
export function shiftMonth({ year, month }, delta) {
  const zero = year * 12 + (month - 1) + delta;
  return { year: Math.floor(zero / 12), month: (zero % 12) + 1 };
}

export function monthLabel({ year, month }) {
  return `${MONTHS[month - 1]} ${year}`;
}

/** Days in a month. Feb via UTC day-0-of-next-month, so leap years are free. */
export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Six weeks of seven days, always.
 *
 * Fixed height on purpose: a grid that is five rows one month and six the next
 * makes everything below it jump, and people lose their place. The cost is a
 * few extra leading/trailing days, which are marked `inMonth: false`.
 */
export function monthGrid({ year, month }, { today = todayInFirmTz() } = {}) {
  const first = toISO(year, month, 1);
  const lead = dayOfWeek(first); // 0 = Sunday
  const start = addDays(first, -lead);

  const weeks = [];
  for (let w = 0; w < 6; w++) {
    const days = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(start, w * 7 + d);
      const [y, m] = date.split('-').map(Number);
      days.push({
        date,
        day: Number(date.slice(8, 10)),
        inMonth: y === year && m === month,
        isToday: date === today,
        isWeekend: d === 0 || d === 6,
      });
    }
    weeks.push(days);
  }
  return weeks;
}

/**
 * Bucket dated things by day.
 *
 * Anything without a valid ISO date is DROPPED, and the count of what was
 * dropped is returned rather than swallowed. A task with no due date is not a
 * task on the 1st of the month, and silently placing it somewhere is how a
 * calendar starts lying. The caller shows the number so it stays visible.
 */
export function groupByDate(events) {
  const byDate = {};
  let undated = 0;
  for (const e of events) {
    if (!isValidISO(e.date)) {
      undated++;
      continue;
    }
    (byDate[e.date] ||= []).push(e);
  }
  for (const list of Object.values(byDate)) {
    list.sort((a, b) => (a.rank ?? 5) - (b.rank ?? 5) || String(a.title).localeCompare(String(b.title)));
  }
  return { byDate, undated };
}

/**
 * The statutory dates worth showing on a calendar, and their weight.
 *
 * `rank` sorts within a day: an SOL and a routine task landing on the same
 * square must not be ordered alphabetically.
 */
export const MATTER_DATE_KINDS = [
  { key: 'sol', label: 'SOL', rank: 0, tone: 'red' },
  { key: 'trialDate', label: 'Trial', rank: 1, tone: 'purple' },
  { key: 'dco', label: 'DCO', rank: 2, tone: 'orange' },
  { key: 'settlementDate', label: 'Settled', rank: 4, tone: 'teal' },
  { key: 'doa', label: 'DOA', rank: 6, tone: 'slate' },
];

/**
 * Flatten matters, tasks and the DCO tab's deadlines into one dated list.
 *
 * Archived matters are excluded: their dates are historical, and an old SOL
 * sitting on the calendar reads as live.
 *
 * ── `sections` is not optional decoration ─────────────────────────────────
 *
 * Every deadline a paralegal transcribes off a docket control order lives in
 * the DCO section's rows, and this function used to take only `matters` and
 * `tasks`. So those rows were WRITE-ONLY: stored, rendered on their own tab,
 * and read by nothing else in the app. A discovery cutoff typed into the DCO
 * tab never reached the calendar, the task list, or the dashboard.
 *
 * The single `dco` DATE on Case Info did calendar, which is what made this
 * hard to spot -- a "DCO" chip appeared, just not the ten deadlines underneath
 * it. A court-ordered deadline that silently fails to appear is the worst
 * shape this system can take, so a caller passing no `sections` now gets no
 * DCO rows rather than quietly getting none.
 */
export function collectEvents({ matters = {}, tasks = {}, sections = {}, kinds = null } = {}) {
  const out = [];
  const want = (k) => !kinds || kinds.includes(k);

  if (want('task')) {
    for (const t of Object.values(tasks)) {
      if (t.completed) continue;
      out.push({
        id: t.id,
        kind: 'task',
        date: t.dueDate,
        title: t.title || t.note || 'Task',
        matterId: t.matterId,
        assignedTo: t.assignedTo,
        source: t.source,
        rank: 3,
        tone: 'sky',
      });
    }
  }

  for (const [id, matter] of Object.entries(matters)) {
    if (matter?.archivedAt) continue;
    for (const kind of MATTER_DATE_KINDS) {
      if (!want(kind.key)) continue;
      const date = matter?.values?.[kind.key];
      if (!date) continue;
      out.push({
        id: `${id}:${kind.key}`,
        kind: kind.key,
        date,
        title: kind.label,
        matterId: id,
        rank: kind.rank,
        tone: kind.tone,
      });
    }

    /*
     * The DCO tab's own rows, under the SAME 'dco' filter as the date above.
     * Staff think of both as "the DCO", and splitting them into two chips
     * would mean ticking two boxes to see one court order.
     *
     * Each row carries its own name -- "Expert designation", "Discovery
     * cutoff" -- because that is the whole point of transcribing them
     * individually rather than keeping one date.
     */
    if (!want('dco')) continue;
    for (const row of sections?.[id]?.dco?.rows || []) {
      if (!row?.date) continue;
      out.push({
        id: `${id}:dco:${row.id}`,
        kind: 'dco',
        date: row.date,
        // A deadline with no name is still a deadline, and hiding it because
        // somebody skipped the label would be the same bug again.
        title: String(row.deadline || '').trim() || 'Docket deadline',
        matterId: id,
        rank: 2,
        tone: 'orange',
      });
    }
  }

  return dropRedundantAutoTasks(out);
}

/**
 * Drop an auto chain task that lands on the square its own trigger occupies.
 *
 * The chain generates a "Trial" task due on the trial date, so a calendar
 * naively showing both renders `Trial — Rivera` twice on one day, in two
 * colours. That reads as a bug even though both rows are real.
 *
 * The DATE wins and the task is dropped, not the other way round, for two
 * reasons: the date is the fact and the task exists only because of it, and
 * the date chip carries the urgency colour that makes an SOL findable at a
 * glance. The task is untouched and still on the Tasks list, which is where
 * completing it belongs.
 *
 * Only `source: 'auto'` tasks are ever dropped. A task someone typed by hand
 * for the trial date is a separate, deliberate intention and always shows.
 */
function dropRedundantAutoTasks(events) {
  const anchored = new Set(
    events.filter((e) => e.kind !== 'task').map((e) => `${e.matterId}|${e.date}`)
  );
  return events.filter(
    (e) => !(e.kind === 'task' && e.source === 'auto' && anchored.has(`${e.matterId}|${e.date}`))
  );
}
