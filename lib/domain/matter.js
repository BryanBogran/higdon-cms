/**
 * Matter-level derived values shared across views.
 */

import { daysFromToday, todayInFirmTz, urgency } from './dates.js';

/**
 * Display title, Filevine style: "Last, First YY-NNN".
 *
 * Kept as a function rather than a stored column for now, but note the Project
 * Hub showed names carrying free-text suffixes ("... 26-044 1st case"), so the
 * schema keeps a `project_name` field and this is only the fallback.
 */
export function matterTitle(matter) {
  const v = matter?.values || {};
  const name = (v.clientName || 'Untitled').trim();
  const num = (v.caseNumber || '').trim();
  return num ? `${name} ${num}` : `${name} (no case #)`;
}

export function initials(matter) {
  const v = matter?.values || {};
  const parts = (v.clientName || '?')
    .replace(/[^A-Za-z ,]/g, '')
    .split(/[ ,]+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** Deterministic avatar colour, so a matter always looks the same. */
const AVATAR_COLORS = [
  'bg-rose-500', 'bg-orange-500', 'bg-amber-500', 'bg-teal-600',
  'bg-sky-600', 'bg-indigo-500', 'bg-violet-500', 'bg-pink-500',
  'bg-emerald-600', 'bg-slate-600',
];

export function avatarColor(id) {
  let h = 0;
  for (let i = 0; i < String(id).length; i++) h = (h * 31 + String(id).charCodeAt(i)) % 997;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export const ACTIVE_STATUSES = new Set(['Open', 'Default Judgment', '']);

export function isActive(matter) {
  if (matter?.archivedAt) return false;
  return ACTIVE_STATUSES.has(matter?.values?.status ?? '');
}

export const STALE_DAYS = 30;

/**
 * Days since the last recorded activity on a matter.
 *
 * Falls back to openDate so a brand-new matter with no notes yet is not unfairly
 * flagged. Returns null when nothing is known -- never 0, which would read as
 * "active today".
 */
export function daysSinceActivity(matter, today = todayInFirmTz()) {
  const stamp = matter?.lastActivityAt;
  if (stamp) {
    const iso = String(stamp).slice(0, 10);
    const d = daysFromToday(iso, today);
    return d === null ? null : -d;
  }
  const open = matter?.values?.openDate;
  const d = daysFromToday(open, today);
  return d === null ? null : -d;
}

export function isStale(matter, today = todayInFirmTz()) {
  if (!isActive(matter)) return false;
  const days = daysSinceActivity(matter, today);
  return days !== null && days >= STALE_DAYS;
}

/** Trial-countdown tiers, as the requirements note asks: 30/60/90/120 days. */
export const TRIAL_TIERS = [30, 60, 90, 120];

export function trialCountdown(matters, today = todayInFirmTz()) {
  const buckets = Object.fromEntries(TRIAL_TIERS.map((t) => [t, []]));
  for (const [id, m] of Object.entries(matters || {})) {
    if (!isActive(m)) continue;
    const days = daysFromToday(m.values?.trialDate, today);
    if (days === null || days < 0) continue;
    for (const tier of TRIAL_TIERS) {
      if (days <= tier) {
        buckets[tier].push({ id, matter: m, days });
        break;
      }
    }
  }
  for (const tier of TRIAL_TIERS) buckets[tier].sort((a, b) => a.days - b.days);
  return buckets;
}

export { urgency };
