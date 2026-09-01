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
    // A setup problem is not a save failure. Saying "Not saved" when the tables
    // simply don't exist yet sends you looking in the wrong place.
    const isSetup = /schema\.sql|tables not found/i.test(saveState.error || '');
    return (
      <span
        title={saveState.error || 'Save failed'}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-white text-xs font-semibold ${
          isSetup ? 'bg-warn-solid' : 'bg-danger-solid-2'
        }`}
      >
        <AlertTriangle size={14} /> {isSetup ? 'Setup needed' : 'Not saved'}
      </span>
    );
  }
  if (saveState.status === 'saved') {
    /*
     * accent-solid-2, not accent-ink or accent-line: this sits on the dark top
     * rail in BOTH themes, so it needs a teal that is legible on dark either
     * way. accent-ink is dark teal in light mode and accent-line is dark teal
     * in dark mode -- each would vanish in one of the two.
     */
    return (
      <span className="flex items-center gap-1 px-2 text-xs text-accent-solid-2" aria-live="polite">
        <Check size={14} /> Saved
      </span>
    );
  }
  return null;
}
