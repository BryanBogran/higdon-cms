/**
 * Date math for statutory deadlines.
 *
 * REWRITTEN, not ported. The prototype's helpers all routed through
 * `new Date(str + "T00:00:00")` (local) and `.toISOString()` (UTC), which is
 * off by one day at any positive UTC offset — while computing Answer Due dates
 * under Tex. R. Civ. P. 99. See docs/DECISIONS.md.
 *
 * Three rules hold throughout this file:
 *
 *   1. A date-only value is the string "YYYY-MM-DD". Never a Date object.
 *   2. Arithmetic goes through Date.UTC on integer components. No local time
 *      ever enters, so results cannot shift with the server's timezone, the
 *      browser's timezone, or DST.
 *   3. Unparseable input returns null, NEVER NaN. NaN is worse than null here
 *      because `NaN < 30` and `NaN < 90` are both false, so every urgency check
 *      falls through to the "safe" branch — which is how the prototype renders a
 *      matter with no SOL as a calm green badge.
 */

/** The firm is in Houston. "Today" and "overdue" resolve here, never in the viewer's zone. */
export const FIRM_TZ = 'America/Chicago';

const DAY_MS = 86400000;

/* ------------------------------------------------------------------ *
 * Parsing and formatting
 * ------------------------------------------------------------------ */

/**
 * Parse "YYYY-MM-DD" into integer parts, validating against the real calendar.
 * Returns null for anything else — including 2024-02-30, which `new Date()`
 * would silently roll forward to March 1.
 */
export function parseISO(value) {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;

  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;

  // Round-trip through UTC to reject impossible days (Feb 30, Apr 31, ...).
  const ts = Date.UTC(y, mo - 1, d);
  const back = new Date(ts);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    return null;
  }
  return { y, m: mo, d, ts };
}

/** True if `value` is a well-formed, real calendar date. */
export function isValidISO(value) {
  return parseISO(value) !== null;
}

const pad = (n) => String(n).padStart(2, '0');

/** Format integer parts (or a UTC timestamp) back to "YYYY-MM-DD". */
export function toISO(y, m, d) {
  if (typeof y === 'number' && m === undefined) {
    const dt = new Date(y);
    return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
  }
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * Today, in the firm's timezone, as "YYYY-MM-DD".
 *
 * The `en-CA` locale formats as YYYY-MM-DD, and `timeZone` pins the calendar
 * day to Central. Without this, a browser running in UTC flips "overdue" a day
 * early every evening after 6pm CT.
 */
export function todayInFirmTz(now = new Date()) {
  return now.toLocaleDateString('en-CA', { timeZone: FIRM_TZ });
}

/** Human display: "Mar 1, 2026". Returns the em dash for empty/invalid input. */
export function fmt(value, { fallback = '—' } = {}) {
  const p = parseISO(value);
  if (!p) return fallback;
  return new Date(p.ts).toLocaleDateString('en-US', {
    timeZone: 'UTC', // the timestamp is already the intended calendar day
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/* ------------------------------------------------------------------ *
 * Arithmetic
 * ------------------------------------------------------------------ */

/** Day of week, 0 = Sunday. Null for invalid input. */
export function dayOfWeek(value) {
  const p = parseISO(value);
  return p ? new Date(p.ts).getUTCDay() : null;
}

/** Add (or subtract, with a negative n) calendar days. Null-safe. */
export function addDays(value, n) {
  const p = parseISO(value);
  if (!p || !Number.isFinite(n)) return null;
  return toISO(p.ts + n * DAY_MS);
}

/** Whole days from `a` to `b`. Positive when `b` is later. Null if either is invalid. */
export function daysBetween(a, b) {
  const pa = parseISO(a);
  const pb = parseISO(b);
  if (!pa || !pb) return null;
  return Math.round((pb.ts - pa.ts) / DAY_MS);
}

/**
 * Days from today (firm timezone) until `value`. Negative means overdue.
 *
 * Returns null — not NaN — when `value` is missing or unparseable. Callers must
 * treat null as "unknown", never as "fine".
 */
export function daysFromToday(value, today = todayInFirmTz()) {
  return daysBetween(today, value);
}

/**
 * The Tex. R. Civ. P. 99 primitive: the Monday on or after `value`.
 *
 * Note "on or after" — if `value` is already a Monday it is returned unchanged.
 * That matches the prototype's behavior and reads day-20-is-Monday as the answer
 * day. Every generated task carries "Confirm with attorney" for exactly this
 * kind of judgment call.
 */
export function nextMondayOnOrAfter(value) {
  const p = parseISO(value);
  if (!p) return null;
  const dow = new Date(p.ts).getUTCDay();
  const delta = (1 - dow + 7) % 7; // 0 when already Monday
  return toISO(p.ts + delta * DAY_MS);
}

/* ------------------------------------------------------------------ *
 * Weekends and federal holidays
 * ------------------------------------------------------------------ */

/** nth weekday of a month, e.g. nthWeekday(2026, 1, 1, 3) = 3rd Monday of January. */
function nthWeekday(year, month, weekday, n) {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const offset = (weekday - first + 7) % 7;
  return 1 + offset + (n - 1) * 7;
}

/** Last given weekday of a month, e.g. last Monday in May = Memorial Day. */
function lastWeekday(year, month) {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const dow = new Date(Date.UTC(year, month - 1, lastDay)).getUTCDay();
  return lastDay - ((dow - 1 + 7) % 7);
}

/**
 * Federal holidays for a year, as { "YYYY-MM-DD": name }.
 *
 * Includes the *observed* date when a fixed-date holiday falls on a weekend
 * (Saturday shifts to the preceding Friday, Sunday to the following Monday),
 * because that is the day the courthouse is actually shut. Both the actual and
 * the observed date are flagged — this function only warns, so over-flagging is
 * the safe direction.
 */
export function federalHolidays(year) {
  const out = {};
  const fixed = [
    [1, 1, "New Year's Day"],
    [6, 19, 'Juneteenth'],
    [7, 4, 'Independence Day'],
    [11, 11, 'Veterans Day'],
    [12, 25, 'Christmas Day'],
  ];

  for (const [mo, d, name] of fixed) {
    const iso = toISO(year, mo, d);
    out[iso] = name;

    const dow = new Date(Date.UTC(year, mo - 1, d)).getUTCDay();
    if (dow === 6) out[addDays(iso, -1)] = `${name} (observed)`;
    if (dow === 0) out[addDays(iso, 1)] = `${name} (observed)`;
  }

  out[toISO(year, 1, nthWeekday(year, 1, 1, 3))] = 'Martin Luther King Jr. Day';
  out[toISO(year, 2, nthWeekday(year, 2, 1, 3))] = "Presidents' Day";
  out[toISO(year, 5, lastWeekday(year, 5))] = 'Memorial Day';
  out[toISO(year, 9, nthWeekday(year, 9, 1, 1))] = 'Labor Day';
  out[toISO(year, 10, nthWeekday(year, 10, 1, 2))] = 'Columbus Day';

  const thanksgiving = nthWeekday(year, 11, 4, 4);
  out[toISO(year, 11, thanksgiving)] = 'Thanksgiving';
  // Not a federal holiday, but courts and most firms are closed.
  out[toISO(year, 11, thanksgiving + 1)] = 'Day after Thanksgiving';

  return out;
}

/** The holiday name for a date, or null. */
export function getHolidayName(value) {
  const p = parseISO(value);
  if (!p) return null;
  return federalHolidays(p.y)[value] || null;
}

/**
 * Why this date is a bad day for a deadline: 'Saturday', 'Sunday', a holiday
 * name, or null if it's an ordinary business day.
 *
 * DELIBERATELY DOES NOT MOVE THE DATE. Tex. R. Civ. P. 4 rolls a deadline
 * landing on a weekend or legal holiday to the next business day, but which
 * holidays a given court observes is a judgment call, and silently adjusting a
 * statutory date is exactly the behavior this system must not have. The UI shows
 * the warning and offers `nextBusinessDay` as a one-click action a human takes.
 */
export function checkBadDate(value) {
  const dow = dayOfWeek(value);
  if (dow === null) return null;
  if (dow === 6) return 'Saturday';
  if (dow === 0) return 'Sunday';
  return getHolidayName(value);
}

/** The next day that is not a weekend or federal holiday. Never returns `value` itself. */
export function nextBusinessDay(value) {
  let cursor = addDays(value, 1);
  for (let guard = 0; cursor && guard < 30; guard++) {
    if (!checkBadDate(cursor)) return cursor;
    cursor = addDays(cursor, 1);
  }
  return cursor;
}

/* ------------------------------------------------------------------ *
 * Presentation helper
 * ------------------------------------------------------------------ */

/**
 * Urgency bucket for a due date.
 *
 * `'unknown'` for a missing or unparseable date — never `'ok'`. This is the
 * fix for the prototype's worst display bug, where an empty SOL rendered as a
 * green "safe" badge because every `NaN < n` comparison was false. Missing data
 * on the highest-stakes field in the firm must never look reassuring.
 */
export function urgency(value, { today = todayInFirmTz(), warnWithin = 90, criticalWithin = 30 } = {}) {
  const days = daysFromToday(value, today);
  if (days === null) return { level: 'unknown', days: null };
  if (days < 0) return { level: 'overdue', days };
  if (days < criticalWithin) return { level: 'critical', days };
  if (days < warnWithin) return { level: 'warning', days };
  return { level: 'ok', days };
}
