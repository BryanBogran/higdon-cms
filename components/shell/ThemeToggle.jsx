'use client';

/**
 * Light / Dark / System, as a three-way segmented control.
 *
 * Three states rather than a switch because "System" is a real answer and the
 * default one: staff who already run their Mac dark should get a dark app
 * without asking, and a two-position switch cannot express "follow the OS"
 * once someone has touched it.
 *
 * ── No ThemeProvider, on purpose ──────────────────────────────────────────
 *
 * lib/data/DataProvider.jsx is 689 lines with two hand-maintained dependency
 * arrays, and its context value feeds every matter, task and activity consumer
 * in the app. Putting the theme in there would re-render all of it on each
 * flip, to move one class on <html>. useSyncExternalStore subscribes only the
 * components that actually display the setting -- which is this one.
 */

import { useSyncExternalStore } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { readPreference, setPreference, subscribeToTheme } from '@/lib/theme';

const OPTIONS = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

export function useThemePreference() {
  /*
   * The server snapshot is 'system' because the server cannot know. The inline
   * script in app/layout.jsx has already applied the real theme to the DOM by
   * the time this hydrates, so a brief disagreement here changes which segment
   * looks selected inside a closed menu -- never what the page looks like.
   */
  return useSyncExternalStore(subscribeToTheme, readPreference, () => 'system');
}

export default function ThemeToggle() {
  const preference = useThemePreference();

  return (
    <div className="px-4 py-3 border-b border-line-soft">
      <p className="text-xs font-medium text-ink-3 mb-1.5">Appearance</p>
      <div
        role="radiogroup"
        aria-label="Appearance"
        className="flex gap-1 p-0.5 rounded-lg bg-raised"
      >
        {OPTIONS.map(({ value, label, icon: Icon }) => {
          const active = preference === value;
          return (
            <button
              key={value}
              role="radio"
              aria-checked={active}
              onClick={() => setPreference(value)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium transition ${
                active
                  ? 'bg-surface text-ink shadow-sm'
                  : 'text-ink-3 hover:text-ink-2'
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
