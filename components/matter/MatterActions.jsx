'use client';

/**
 * Matter-level actions: archive and restore.
 *
 * `archiveMatter` and `unarchiveMatter` existed in the data layer from the
 * start with nothing calling them. That matters more than it sounds: you will
 * import rows that turn out to be wrong, and without this a paralegal has to
 * ask a developer to remove them.
 *
 * Archive is a SOFT delete — `deleted_at` is set, the row stays. There is
 * deliberately no hard delete in the UI. Destroying a legal file from a web
 * button is not a feature, and the schema carries a `legal_hold` column for
 * matters that must never be removed at all.
 */

import { useEffect, useRef, useState } from 'react';
import { MoreVertical, Archive, ArchiveRestore, Loader2 } from 'lucide-react';
import { useData } from '@/lib/data/DataProvider';
import { matterTitle } from '@/lib/domain/matter';

export default function MatterActions({ matterId, matter }) {
  const { archiveMatter, unarchiveMatter } = useData();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef(null);
  const archived = Boolean(matter?.archivedAt);

  useEffect(() => {
    function onDocClick(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  async function toggleArchive() {
    if (
      !archived &&
      !confirm(
        `Archive ${matterTitle(matter)}?\n\n` +
          'It drops off the dashboard, task list and case list. Nothing is deleted — ' +
          'tick "Show archived" in Project Hub to find it again.'
      )
    ) {
      return;
    }
    setBusy(true);
    await (archived ? unarchiveMatter(matterId) : archiveMatter(matterId));
    setBusy(false);
    setOpen(false);
  }

  return (
    <div ref={boxRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="p-2 rounded border border-slate-300 text-slate-500 hover:bg-slate-50"
        title="Matter actions"
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <MoreVertical size={16} />}
      </button>

      {open ? (
        <div className="absolute right-0 mt-1.5 w-64 bg-white rounded-lg shadow-xl border border-slate-200 overflow-hidden z-50">
          <button
            onClick={toggleArchive}
            className="w-full flex items-start gap-2.5 px-4 py-2.5 text-sm text-left hover:bg-slate-50"
          >
            {archived ? (
              <ArchiveRestore size={16} className="mt-0.5 text-teal-600 shrink-0" />
            ) : (
              <Archive size={16} className="mt-0.5 text-slate-500 shrink-0" />
            )}
            <span>
              <span className="block font-medium text-slate-900">
                {archived ? 'Restore matter' : 'Archive matter'}
              </span>
              <span className="block text-xs text-slate-500">
                {archived
                  ? 'Return it to the active case list.'
                  : 'Hide from active lists. Nothing is deleted.'}
              </span>
            </span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
