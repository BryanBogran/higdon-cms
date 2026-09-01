'use client';

/**
 * Matter-level actions: archive, restore, and permanent deletion.
 *
 * ── Two steps, not one ────────────────────────────────────────────────
 *
 * Delete is offered ONLY on a matter that is already archived. Not
 * bureaucracy: archive is reversible and reviewable, so making it the
 * required first step means every permanent deletion was preceded by a
 * moment where the case sat visibly removed and nobody objected. It also
 * means the destructive item is never adjacent to the routine one in a
 * menu somebody is clicking quickly.
 *
 * ── Typing the case number ────────────────────────────────────────────
 *
 * A confirm() dialog is dismissed by muscle memory; people click OK on
 * dialogs they have not read, which is exactly why browsers made them
 * cheap. Typing the case number cannot be done by accident and cannot be
 * done on the wrong case, because the wrong case has a different number.
 *
 * ── What the button is honest about ───────────────────────────────────
 *
 * The Drive folder is NOT deleted. Nothing in this system reaches into
 * Google to bin a client's medical records because someone tidied a case
 * list, and a "delete" that leaves documents behind without saying so is
 * a lie about what just happened. The panel says it before you type.
 *
 * The AUDIT HISTORY is not deleted either, and this list used to claim it
 * was. The database refused — audit_event carries a trigger that stops
 * even a SECURITY DEFINER function from touching it — and the database
 * was right: a log that can be erased from the same button that erases
 * the case proves nothing about either. See supabase/011_delete_matter.sql.
 */

import { useEffect, useRef, useState } from 'react';
import {
  MoreVertical, Archive, ArchiveRestore, Trash2, Loader2, AlertTriangle, ExternalLink,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useData } from '@/lib/data/DataProvider';
import { matterTitle } from '@/lib/domain/matter';

export default function MatterActions({ matterId, matter }) {
  const router = useRouter();
  const { archiveMatter, unarchiveMatter, deleteMatter } = useData();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const boxRef = useRef(null);
  const archived = Boolean(matter?.archivedAt);

  const caseNumber = matter?.values?.caseNumber || '';
  const driveFolderId = matter?.driveFolderId || '';

  /*
   * What has to be typed. The case number when there is one; otherwise the
   * word DELETE, because a numberless matter -- an import that went wrong,
   * which is the main thing this feature is for -- would otherwise be
   * confirmable by typing nothing at all.
   */
  const phrase = caseNumber || 'DELETE';
  const matches = typed.trim().toUpperCase() === phrase.toUpperCase();

  useEffect(() => {
    function onDocClick(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) {
        setOpen(false);
        setConfirming(false);
      }
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

  async function doDelete() {
    if (!matches) return;
    setBusy(true);
    setError('');
    const result = await deleteMatter(matterId, { reason: reason.trim() });
    setBusy(false);

    if (!result?.ok) {
      // Shown as written. A legal-hold refusal names the case and says what
      // to do; wrapping it in "Could not delete" would bury that.
      setError(result?.error || 'Could not delete that matter.');
      return;
    }

    setOpen(false);
    setConfirming(false);
    // The matter no longer exists, so this page cannot render. Replace
    // rather than push: Back must not return to a dead route.
    router.replace('/projects');
  }

  return (
    <div ref={boxRef} className="relative">
      <button
        onClick={() => { setOpen((v) => !v); setConfirming(false); setError(''); }}
        className="p-2 rounded border border-line-strong text-ink-3 hover:bg-hover"
        title="Matter actions"
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <MoreVertical size={16} />}
      </button>

      {open ? (
        <div className="absolute right-0 mt-1.5 w-80 bg-surface rounded-lg shadow-xl border border-line overflow-hidden z-50">
          <button
            onClick={toggleArchive}
            className="w-full flex items-start gap-2.5 px-4 py-2.5 text-sm text-left hover:bg-hover"
          >
            {archived ? (
              <ArchiveRestore size={16} className="mt-0.5 text-accent-ink shrink-0" />
            ) : (
              <Archive size={16} className="mt-0.5 text-ink-3 shrink-0" />
            )}
            <span>
              <span className="block font-medium text-ink">
                {archived ? 'Restore matter' : 'Archive matter'}
              </span>
              <span className="block text-xs text-ink-3">
                {archived
                  ? 'Return it to the active case list.'
                  : 'Hide from active lists. Nothing is deleted.'}
              </span>
            </span>
          </button>

          {/* ---- permanent deletion ---- */}
          <div className="border-t border-line-soft">
            {!archived ? (
              <div className="px-4 py-2.5 flex items-start gap-2.5">
                <Trash2 size={16} className="mt-0.5 text-ink-4 shrink-0" />
                <span>
                  <span className="block text-sm font-medium text-ink-4">Delete permanently</span>
                  <span className="block text-xs text-ink-4">
                    Archive it first. A case has to sit removed before it can be destroyed.
                  </span>
                </span>
              </div>
            ) : !confirming ? (
              <button
                onClick={() => { setConfirming(true); setTyped(''); setReason(''); setError(''); }}
                className="w-full flex items-start gap-2.5 px-4 py-2.5 text-sm text-left hover:bg-danger-bg"
              >
                <Trash2 size={16} className="mt-0.5 text-danger-ink shrink-0" />
                <span>
                  <span className="block font-medium text-danger-ink">Delete permanently</span>
                  <span className="block text-xs text-ink-3">
                    Removes the case and everything on it. Cannot be undone.
                  </span>
                </span>
              </button>
            ) : (
              <div className="p-4 bg-danger-bg/60">
                <p className="flex items-start gap-1.5 text-sm font-semibold text-danger-ink-strong">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                  Delete {matterTitle(matter)}?
                </p>

                <ul className="mt-2 space-y-1 text-xs text-ink-2 list-disc pl-4">
                  <li>Its notes, tasks, checklist, deadlines and section rows go with it.</li>
                  <li>
                    Its <span className="font-semibold text-ink">audit history is kept</span> —
                    who changed what, and when. That is what the log is for, and it stays
                    whether or not the case does.
                  </li>
                  <li>
                    <span className="font-semibold text-ink">The Google Drive folder is not touched.</span>{' '}
                    {driveFolderId ? (
                      <a
                        href={`https://drive.google.com/drive/folders/${driveFolderId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-0.5 text-accent-ink hover:underline"
                      >
                        Open it <ExternalLink size={10} />
                      </a>
                    ) : null}{' '}
                    Delete the documents there yourself if you want them gone.
                  </li>
                  <li>This cannot be undone.</li>
                </ul>

                <label className="block mt-3 text-xs text-ink-2">
                  Type <span className="font-mono font-semibold text-ink">{phrase}</span> to confirm
                  <input
                    autoFocus
                    className="input mt-1 w-full text-sm"
                    value={typed}
                    onChange={(e) => { setTyped(e.target.value); setError(''); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && matches) doDelete(); }}
                    placeholder={phrase}
                    autoComplete="off"
                    aria-label={`Type ${phrase} to confirm deletion`}
                  />
                </label>

                <label className="block mt-2 text-xs text-ink-2">
                  Why <span className="text-ink-4">(optional — kept in the audit record)</span>
                  <input
                    className="input mt-1 w-full text-sm"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Duplicate of 26-041"
                  />
                </label>

                {error ? (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-danger-ink-strong">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {error}
                  </p>
                ) : null}

                <div className="mt-3 flex items-center gap-2">
                  <button
                    onClick={doDelete}
                    disabled={!matches || busy}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-danger-solid text-white text-xs font-semibold hover:bg-danger-solid-2 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {busy ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                    Delete for good
                  </button>
                  <button
                    onClick={() => setConfirming(false)}
                    className="px-3 py-1.5 rounded border border-line-strong text-xs text-ink-2 hover:bg-surface"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
