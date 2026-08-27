'use client';

/**
 * Saved / Saving / Not saved -- Retry.
 *
 * Not polish. Every persist path in the prototype swallowed its error
 * (.catch(() => {}) at four call sites), so "the paralegal marked Served done,
 * it didn't save, and nobody found out" was reachable. On a legal file that is
 * the one failure mode that must be impossible.
 */

import { useData } from '@/lib/data/DataProvider';
import { AlertTriangle, Check } from 'lucide-react';

export default function SaveIndicator() {
  const { saveState } = useData();

  if (saveState.status === 'error') {
    return (
      <span
        title={saveState.error || 'Save failed'}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-red-500 text-white text-xs font-semibold"
      >
        <AlertTriangle size={14} /> Not saved
      </span>
    );
  }
  if (saveState.status === 'saved') {
    return (
      <span className="flex items-center gap-1 px-2 text-xs text-teal-300" aria-live="polite">
        <Check size={14} /> Saved
      </span>
    );
  }
  return null;
}
