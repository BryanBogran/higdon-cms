'use client';

/** The matter's Activity feed -- Filevine's default view of a matter. */

import { useMemo } from 'react';
import { useData } from '@/lib/data/DataProvider';
import ActivityCard from '@/components/activity/ActivityCard';
import ActivityComposer from '@/components/activity/ActivityComposer';

export default function ActivitySection({ matterId }) {
  const { activity } = useData();

  const { pinned, rest } = useMemo(() => {
    const mine = Object.values(activity)
      .filter((a) => a.matterId === matterId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return { pinned: mine.filter((a) => a.pinned), rest: mine.filter((a) => !a.pinned) };
  }, [activity, matterId]);

  return (
    <div>
      <ActivityComposer matterId={matterId} />

      {pinned.length > 0 ? (
        <>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-slate-700">Pinned</h3>
            <span className="text-xs text-slate-500">{pinned.length} items</span>
          </div>
          {pinned.map((a) => (
            <ActivityCard key={a.id} entry={a} showMatter={false} />
          ))}
        </>
      ) : null}

      {rest.length > 0 ? (
        <>
          {pinned.length > 0 ? <h3 className="text-sm font-semibold text-slate-700 mt-6 mb-2">Activity</h3> : null}
          {rest.map((a) => (
            <ActivityCard key={a.id} entry={a} showMatter={false} />
          ))}
        </>
      ) : null}

      {pinned.length === 0 && rest.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-400">
          No activity yet. Add a note above.
        </p>
      ) : null}
    </div>
  );
}
