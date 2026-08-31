'use client';

/**
 * Create a Project — the slide-over, matching Filevine.
 *
 * It replaces a full-page form, and the difference is not cosmetic: opening a
 * case is something you do while looking at the list of cases, and a page
 * navigation loses that place.
 *
 * ── The client is picked, not typed ──────────────────────────────────────
 *
 * Typing searches contacts already on file; the + creates one. That is the
 * whole point of the change. A retyped name is a new string, so "Rivera,
 * Marcus" on his second case shared nothing with his first: correct a phone
 * number on one and the other kept the old one, and nothing could answer
 * "what else is this person on".
 *
 * ── The Drive folder happens here ────────────────────────────────────────
 *
 * /api/drive/provision runs on create. It ADOPTS a folder that already
 * matches before creating one, so a case whose folder intake made by hand
 * links to that rather than growing a second, and the standard subfolders are
 * created only for genuinely new cases. Never allowed to fail the creation:
 * the matter is the real action and the folder is a convenience.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X, UserPlus, Search, Loader2, AlertCircle, Check, FolderPlus } from 'lucide-react';
import { useData } from '@/lib/data/DataProvider';
import { todayInFirmTz } from '@/lib/domain/dates';
import { searchContacts, displayName } from '@/lib/domain/contact';
import ContactEditor from '@/components/contacts/ContactEditor';

const PROJECT_TYPES = [{ key: 'pi-master', label: 'Personal Injury (Master)' }];

export default function CreateProjectPanel({ open, onClose }) {
  const router = useRouter();
  const { contacts, createMatter, linkClientContact } = useData();

  const [projectType, setProjectType] = useState(PROJECT_TYPES[0].key);
  const [query, setQuery] = useState('');
  const [client, setClient] = useState(null);
  const [projectName, setProjectName] = useState('');
  const [showResults, setShowResults] = useState(false);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const searchRef = useRef(null);

  const roster = useMemo(() => Object.values(contacts || {}), [contacts]);
  const results = useMemo(() => searchContacts(roster, query), [roster, query]);

  // Escape closes, but only when no dialog is stacked on top of it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape' && !editing) onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, editing, onClose]);

  useEffect(() => {
    if (open) { setError(''); setBusy(''); }
  }, [open]);

  function pick(contact) {
    setClient(contact);
    setQuery('');
    setShowResults(false);
  }

  async function submit(e) {
    e.preventDefault();
    if (!client) { setError('A client is required.'); return; }
    setError('');

    setBusy('Creating the case…');
    const name = displayName(client);
    const result = await createMatter({
      clientName: name,
      projectName: projectName.trim(),
      status: 'Open',
      openDate: todayInFirmTz(),
    });

    if (!result?.ok || !result.id) {
      setBusy('');
      setError(result?.error || 'Could not create the project.');
      return;
    }

    // Point the matter at the contact record, not just its name.
    await linkClientContact(result.id, client.id, name);

    setBusy('Setting up the Drive folder…');
    try {
      await fetch('/api/drive/provision', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ matterId: result.id }),
      });
    } catch {
      // Offline, or Drive unreachable. The Docs tab offers a button.
    }

    setBusy('');
    onClose();
    router.push(`/matters/${result.id}`);
  }

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/30" onClick={onClose} aria-hidden="true" />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Create a Project"
        className="fixed right-0 top-0 z-40 h-full w-full max-w-md bg-white shadow-2xl flex flex-col"
      >
        <div className="flex items-start justify-between p-5 border-b border-slate-100">
          <h2 className="text-xl font-bold text-slate-900">Create a Project</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 text-slate-400 hover:text-slate-700">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={submit} className="flex-1 overflow-y-auto p-5 space-y-5">
          <div>
            <label htmlFor="cp-org" className="block text-sm text-slate-500 mb-1">Org*</label>
            <input id="cp-org" className="input w-full bg-slate-50 text-slate-500" value="Higdon Lawyers" disabled />
          </div>

          <div>
            <label htmlFor="cp-type" className="block text-sm text-slate-500 mb-1">Project Type*</label>
            <select id="cp-type" className="input w-full" value={projectType} onChange={(e) => setProjectType(e.target.value)}>
              {PROJECT_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </div>

          {/* ---- client ---- */}
          <div>
            <label htmlFor="cp-client" className="block text-sm text-slate-500 mb-1">Add Client*</label>

            {client ? (
              <div className="flex items-center gap-2 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2.5">
                <Check size={15} className="text-teal-600 shrink-0" />
                <span className="flex-1 min-w-0 truncate text-sm font-medium text-slate-900">
                  {displayName(client)}
                </span>
                <button type="button" onClick={() => setEditing(client)} className="text-xs text-teal-700 hover:underline">
                  Edit
                </button>
                <button type="button" onClick={() => setClient(null)} aria-label="Choose a different client"
                  className="p-0.5 text-slate-400 hover:text-slate-700">
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <input
                    id="cp-client"
                    ref={searchRef}
                    className="input w-full pl-9"
                    placeholder="Search contacts"
                    value={query}
                    autoComplete="off"
                    onChange={(e) => { setQuery(e.target.value); setShowResults(true); }}
                    onFocus={() => setShowResults(true)}
                  />
                  {showResults && query.trim() ? (
                    <ul className="absolute z-10 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg max-h-64 overflow-y-auto">
                      {results.length ? results.map((c) => (
                        <li key={c.id}>
                          <button type="button" onClick={() => pick(c)}
                            className="w-full text-left px-3 py-2 hover:bg-slate-50">
                            <span className="block text-sm font-medium text-slate-900">{displayName(c)}</span>
                            {(c.phones?.[0]?.value || c.emails?.[0]?.value) ? (
                              <span className="block text-xs text-slate-500 truncate">
                                {c.phones?.[0]?.value || c.emails?.[0]?.value}
                              </span>
                            ) : null}
                          </button>
                        </li>
                      )) : (
                        <li className="px-3 py-3 text-sm text-slate-500">
                          No contact matches “{query.trim()}”.
                          <button type="button"
                            onClick={() => setEditing({ lastName: query.trim().split(',')[0]?.trim() || '' })}
                            className="ml-1 text-teal-700 hover:underline">
                            Create one
                          </button>
                        </li>
                      )}
                    </ul>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => setEditing({})}
                  aria-label="Create a new contact"
                  title="Create a new contact"
                  className="shrink-0 w-10 rounded-lg border border-slate-300 grid place-items-center text-slate-500 hover:border-teal-500 hover:text-teal-700"
                >
                  <UserPlus size={16} />
                </button>
              </div>
            )}
            <p className="mt-1 text-[11px] text-slate-400">
              Picked from contacts, so the same person on two cases is one record.
            </p>
          </div>

          <div>
            <label htmlFor="cp-name" className="block text-sm text-slate-500 mb-1">Project Name</label>
            <input id="cp-name" className="input w-full" placeholder="Defaults to the client name and case number"
              value={projectName} onChange={(e) => setProjectName(e.target.value)} />
          </div>

          {/* Real in Filevine, nowhere to go here. Saying so beats a box that
              silently discards what you typed. */}
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-sm font-medium text-slate-700">Add a Team</p>
            <p className="mt-1 text-xs text-slate-500">
              Not built. Everyone signed in sees every matter, which matches how the firm works
              today — so a team picker would not restrict anything.
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-sm font-medium text-slate-700">Subscribe to Project Notifications</p>
            <p className="mt-1 text-xs text-slate-500">Not built. There is no notification system yet.</p>
          </div>

          <p className="flex items-start gap-1.5 text-xs text-slate-500">
            <FolderPlus size={13} className="mt-0.5 shrink-0 text-slate-400" />
            A Drive folder is set up on create — an existing folder for this client is adopted if
            there is one, rather than a second being made.
          </p>

          {error ? (
            <p className="flex items-start gap-1.5 text-sm text-rose-700">
              <AlertCircle size={14} className="mt-0.5 shrink-0" /> {error}
            </p>
          ) : null}
        </form>

        <div className="flex items-center justify-end gap-3 p-5 border-t border-slate-100">
          {busy ? (
            <span className="mr-auto flex items-center gap-1.5 text-xs text-slate-500">
              <Loader2 size={12} className="animate-spin" /> {busy}
            </span>
          ) : null}
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900">
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!client || Boolean(busy)}
            className="px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Create Project
          </button>
        </div>
      </aside>

      {editing ? (
        <ContactEditor
          contact={editing}
          onCancel={() => setEditing(null)}
          onSaved={(saved) => { setEditing(null); pick(saved); }}
        />
      ) : null}
    </>
  );
}
