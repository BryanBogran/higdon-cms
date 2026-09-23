'use client';

import { STATUS_BY_KEY } from '@/lib/domain/help';

/**
 * Tone → theme tokens, so a status reads the same in light and dark.
 * Resolved is the ok/green set: done should look done at a glance.
 */
export const TONE = {
  slate: 'bg-raised text-ink-2 border-line',
  amber: 'bg-warn-bg text-warn-ink-strong border-warn-line',
  violet: 'bg-cat-violet-bg text-cat-violet-ink border-cat-violet-line',
  green: 'bg-ok-bg text-ok-ink border-ok-line',
};

export default function StatusPill({ status, className = '' }) {
  const s = STATUS_BY_KEY[status] || STATUS_BY_KEY.open;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${TONE[s.tone]} ${className}`}
    >
      {s.label}
    </span>
  );
}

/** "3h ago", "2d ago" — the list's sense of time. */
export function ago(iso) {
  if (!iso) return '';
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return 'just now';
  const mins = secs / 60;
  if (mins < 60) return `${Math.floor(mins)}m ago`;
  const hrs = mins / 60;
  if (hrs < 24) return `${Math.floor(hrs)}h ago`;
  const days = hrs / 24;
  if (days < 30) return `${Math.floor(days)}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
