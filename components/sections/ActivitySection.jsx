'use client';

/** The matter's Activity feed -- Filevine's default view of a matter. */

import { useMemo, useState } from 'react';
import { useData } from '@/lib/data/DataProvider';
import { kindCounts, filterByKind } from '@/lib/domain/activity-filter';
import ActivityCard from '@/components/activity/ActivityCard';
import ActivityComposer from '@/components/activity/ActivityComposer';
import EmailIntake, { EmailDropTarget } from '@/components/activity/EmailIntake';

export default function ActivitySection({ matterId }) {
  const { activity } = useData();
  const [kind, setKind] = useState('all');

  // Counted BEFORE filtering, so the numbers on the tabs do not change as you
  // click between them -- a count that moves when you use it is not a count.
  const mine = useMemo(
    () => Object.values(activity)
      .filter((a) => a.matterId === matterId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    [activity, matterId]
  );
  const tabs = useMemo(() => kindCounts(mine), [mine]);

  const { pinned, rest } = useMemo(() => {
    const shown = filterByKind(mine, kind);
    return { pinned: shown.filter((a) => a.pinned), rest: shown.filter((a) => !a.pinned) };
  }, [mine, kind]);

  return (
    <EmailDropTarget matterId={matterId}>
      <EmailIntake matterId={matterId} />
      <ActivityComposer matterId={matterId} />

      {/*
        Only shown when there is more than one kind to choose between. A single
        "All" tab on a quiet case is a control that does nothing.
      */}
      {tabs.length > 2 ? (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setKind(t.key)}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${
                kind === t.key
                  ? 'border-accent-solid bg-accent-bg font-semibold text-accent-ink-strong'
                  : 'border-line-strong text-ink-3 hover:border-ink-4 hover:text-ink'
              }`}
            >
              {t.label}
              <span className={kind === t.key ? 'text-accent-ink' : 'text-ink-4'}>{t.count}</span>
            </button>
          ))}
        </div>
      ) : null}

      {pinned.length > 0 ? (
        <>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-ink-2">Pinned</h3>
            <span className="text-xs text-ink-3">{pinned.length} items</span>
          </div>
          {pinned.map((a) => (
            <ActivityCard key={a.id} entry={a} showMatter={false} />
          ))}
        </>
      ) : null}

      {rest.length > 0 ? (
        <>
          {pinned.length > 0 ? <h3 className="text-sm font-semibold text-ink-2 mt-6 mb-2">Activity</h3> : null}
          {rest.map((a) => (
            <ActivityCard key={a.id} entry={a} showMatter={false} />
          ))}
        </>
      ) : null}

      {pinned.length === 0 && rest.length === 0 ? (
        <p className="py-10 text-center text-sm text-ink-4">
          No activity yet. Add a note above.
        </p>
      ) : null}
    </EmailDropTarget>
  );
}
