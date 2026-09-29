'use client';

/**
 * Editing one row -- a right-hand drawer, the shape of the help panel.
 *
 * Fields sit in HEADED GROUPS on a STRICT two-column grid, the way the firm's
 * printed Filevine section sheets lay them out: deliberate pairs side by side
 * (Bills ordered / Bills received), long text and attachments full width.
 * Being a grid rather than a wrap, every label in a row starts on the same
 * line -- the fix for the ragged, gappy form the firm sent a screenshot of,
 * where boxes of different heights flowed into whatever space was left.
 *
 * Editing saves as you type, through the same updateSectionRow the table used,
 * so nothing about how data is stored has changed. Adding keeps the old draft
 * behaviour: nothing is written until Add, and a failed save keeps what was
 * typed.
 */

import { useEffect, useState } from 'react';
import { X, Trash2, Loader2, AlertTriangle, Plus } from 'lucide-react';
import FieldInput from '../FieldInput';
import GenerateDoc from '../GenerateDoc';
import { useData } from '@/lib/data/DataProvider';
import { displayValue } from '@/lib/sections/layout';

export default function ItemEditor({
  collection, layout, storageKey, matterId, uploadFolder, row, noun = 'entry', docTemplates = [], onClose,
}) {
  const { addSectionRow, updateSectionRow, deleteSectionRow } = useData();
  const adding = !row;
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const values = adding ? draft : row;
  const byKey = new Map(collection.columns.map((c) => [c.key, c]));
  const hasDraft = Object.values(draft).some((v) => v !== '' && v !== null && v !== undefined);

  /*
   * Closing is always safe while editing -- every change is already saved.
   * While ADDING it would throw away what was typed, so a stray click on the
   * backdrop or Escape does nothing once there is something in the form.
   */
  const tryClose = () => { if (!(adding && hasDraft)) onClose(); };

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') tryClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  function change(key, val) {
    if (adding) setDraft((d) => ({ ...d, [key]: val }));
    else updateSectionRow(matterId, storageKey, row.id, { [key]: val });
  }

  async function add() {
    setBusy(true);
    setError('');
    const result = await addSectionRow(matterId, storageKey, draft);
    setBusy(false);
    if (result?.ok) onClose();
    else setError(result?.error || 'That could not be saved. Nothing was stored — please try again.');
  }

  const title = adding ? `New ${noun}` : (displayValue(byKey.get(layout.left), row[layout.left], row) || 'Unnamed');

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onMouseDown={tryClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-2xl flex-col bg-surface text-ink shadow-2xl"
      >
        <header className="flex items-start gap-3 border-b border-line-soft px-6 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-4">{collection.label}</p>
            <h2 className="truncate text-lg font-semibold">{title}</h2>
          </div>
          {!adding && docTemplates.length ? (
            <div className="flex shrink-0 items-center gap-1">
              {docTemplates.map((t) => (
                <GenerateDoc key={t.key} matterId={matterId} template={t} row={row} existing={row[t.targetField]} />
              ))}
            </div>
          ) : null}
          <button type="button" onClick={tryClose} aria-label="Close" className="p-1 text-ink-4 hover:text-ink-2">
            <X size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-6 py-5">
          {layout.groups.map((g, gi) => (
            <section key={g.title || `g${gi}`}>
              {g.title ? (
                <h3 className="mb-3 flex items-center gap-3 text-[11px] font-bold uppercase tracking-wider text-ink-3">
                  {g.title}
                  <span className="h-px flex-1 bg-line-soft" />
                </h3>
              ) : null}
              <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
                {g.fields.map((f) => {
                  const col = byKey.get(f.key);
                  return (
                    <div key={f.key} className={f.full ? 'sm:col-span-2' : 'min-w-0'}>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                        {col.label}
                      </label>
                      <FieldInput
                        field={{ ...col, inputs: collection.calculated?.[col.key]?.inputs }}
                        value={values[col.key]}
                        row={values}
                        matterId={matterId}
                        uploadFolder={uploadFolder}
                        onChange={(val) => change(col.key, val)}
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        <footer className="flex items-center gap-2 border-t border-line-soft px-6 py-3">
          {error ? (
            <p className="mr-auto flex items-start gap-1.5 text-sm text-danger-ink">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}
            </p>
          ) : null}

          {adding ? (
            <>
              <button type="button" onClick={onClose} className="ml-auto px-3 py-2 text-sm text-ink-2 hover:text-ink">
                Cancel
              </button>
              <button
                type="button"
                onClick={add}
                disabled={busy || !hasDraft}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-2 disabled:opacity-40"
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                Add {noun}
              </button>
            </>
          ) : (
            <>
              {/*
                Delete lives here, behind a second click, rather than as a bin
                on every row of the list -- a list of cards is somewhere people
                click freely.
              */}
              {confirmDelete ? (
                <span className="flex items-center gap-2 text-sm">
                  <span className="text-danger-ink">Delete this {noun}?</span>
                  <button
                    type="button"
                    onClick={() => { deleteSectionRow(matterId, storageKey, row.id); onClose(); }}
                    className="rounded-lg bg-danger-solid px-3 py-1.5 font-semibold text-white"
                  >
                    Delete
                  </button>
                  <button type="button" onClick={() => setConfirmDelete(false)} className="px-2 py-1.5 text-ink-2">
                    Keep
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="flex items-center gap-1.5 px-2 py-2 text-sm text-ink-3 hover:text-danger-ink"
                >
                  <Trash2 size={14} /> Delete
                </button>
              )}
              <span className="ml-auto text-xs text-ink-4">Changes save as you type</span>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-2"
              >
                Done
              </button>
            </>
          )}
        </footer>
      </aside>
    </div>
  );
}
