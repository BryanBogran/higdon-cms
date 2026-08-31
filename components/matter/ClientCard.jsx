'use client';

/**
 * The client's name in the matter header, as a link to their contact card.
 *
 * ── The bug this exists to fix ────────────────────────────────────────
 *
 * A phone number typed on the Contacts page did not appear on the case.
 * The header was already reading through to the linked contact — that
 * part was right — but a case IMPORTED from a spreadsheet or created from
 * a Drive folder has a client NAME and no client RECORD. Editing the
 * contact changed something the matter did not point at, so the case went
 * on saying "no phone on file" while the number sat one page away.
 *
 * Linking was only possible at creation time, on the Create a Project
 * panel. Every one of the 343 cases coming across from Drive is created
 * without it, so the link had to become something you can make afterwards
 * — from the place you notice it is missing.
 *
 * ── Three states ──────────────────────────────────────────────────────
 *
 *   linked      the name opens the contact card. Edit it there and the
 *               header updates, because it is one record.
 *   unlinked    the name opens a picker. A contact with the same name is
 *               offered as one click; otherwise search, or create.
 *   no name     nothing to link. Says so rather than offering a search
 *               for the empty string.
 *
 * ── Linking does NOT rename the case ──────────────────────────────────
 *
 * `linkClientContact` can overwrite the matter's client_name and here it
 * is deliberately not asked to. The name on an imported case is what
 * staff recognise it by; silently replacing it because a contact spells
 * it differently would be a worse surprise than the two disagreeing. When
 * they do differ, the panel shows both.
 */

import { useMemo, useState } from 'react';
import { IdCard, Search, UserPlus, X, Link2, Link2Off, Check, AlertTriangle } from 'lucide-react';
import { useData } from '@/lib/data/DataProvider';
import {
  displayName, searchContacts, matchContactsByName, primaryPhone, primaryEmail,
} from '@/lib/domain/contact';
import ContactEditor from '@/components/contacts/ContactEditor';

export default function ClientCard({ matterId, matter }) {
  const { contacts, linkClientContact } = useData();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const clientName = (matter?.values?.clientName || '').trim();
  const linked = matter?.clientContactId ? contacts?.[matter.clientContactId] : null;

  const roster = useMemo(() => Object.values(contacts || {}), [contacts]);
  const suggestions = useMemo(
    () => matchContactsByName(roster, clientName),
    [roster, clientName],
  );
  const results = useMemo(() => searchContacts(roster, query), [roster, query]);

  async function link(contact) {
    setBusy(true);
    setError('');
    // No display name passed: see the note at the top. The case keeps the
    // name staff know it by.
    const r = await linkClientContact(matterId, contact.id);
    setBusy(false);
    if (!r?.ok) { setError(r?.error || 'Could not link that contact.'); return; }
    setOpen(false);
    setQuery('');
  }

  async function unlink() {
    setBusy(true);
    const r = await linkClientContact(matterId, '');
    setBusy(false);
    if (!r?.ok) { setError(r?.error || 'Could not unlink.'); return; }
    setOpen(false);
  }

  /* ---- linked: the name is a link to the card ---- */
  if (linked) {
    // The case name and the card name can differ, because linking does not
    // rename the case. Showing both beats showing one and hoping.
    const cardName = displayName(linked);
    const differs = clientName && cardName && clientName !== cardName;
    return (
      <>
        <span className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setEditing(linked)}
            title={`Open ${cardName}'s contact card`}
            className="flex items-center gap-1.5 text-teal-700 hover:underline"
          >
            <IdCard size={15} className="text-teal-600" />
            {clientName || cardName}
          </button>
          {differs ? (
            <span className="text-xs text-slate-400" title="The contact card is filed under a different name">
              (card: {cardName})
            </span>
          ) : null}
          <button
            type="button"
            onClick={unlink}
            disabled={busy}
            title="Unlink this contact card from the case"
            className="p-0.5 text-slate-300 hover:text-slate-600 disabled:opacity-40"
          >
            <Link2Off size={13} />
          </button>
        </span>
        {editing ? (
          <ContactEditor
            contact={editing}
            onCancel={() => setEditing(null)}
            onSaved={() => setEditing(null)}
          />
        ) : null}
      </>
    );
  }

  /* ---- no name at all ---- */
  if (!clientName) {
    return (
      <span className="flex items-center gap-1.5 text-slate-400">
        <IdCard size={15} /> no client name
      </span>
    );
  }

  /* ---- unlinked: the name opens a picker ---- */
  return (
    <>
      <span className="relative flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => { setOpen((v) => !v); setError(''); }}
          title="No contact card linked — click to link one"
          className="flex items-center gap-1.5 text-slate-700 hover:text-teal-700 group"
        >
          <IdCard size={15} className="text-slate-400 group-hover:text-teal-600" />
          {clientName}
          <span className="inline-flex items-center gap-0.5 rounded border border-dashed border-slate-300 px-1 py-0.5 text-[10px] uppercase tracking-wide text-slate-400 group-hover:border-teal-400 group-hover:text-teal-700">
            <Link2 size={9} /> link
          </span>
        </button>

        {open ? (
          <div className="absolute left-0 top-full z-50 mt-1.5 w-80 rounded-lg border border-slate-200 bg-white p-3 shadow-xl">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold text-slate-900">Link a contact card</p>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close"
                className="p-0.5 text-slate-400 hover:text-slate-700">
                <X size={14} />
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Then a phone or email saved on that card shows here, because it is one record.
            </p>

            {/* The one-click path, and the reason 343 cases can be linked
                without anyone typing a search. */}
            {suggestions.length ? (
              <div className="mt-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  {suggestions.length === 1 ? 'Same name' : 'Same name — pick one'}
                </p>
                {suggestions.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    disabled={busy}
                    onClick={() => link(c)}
                    className="mt-1 flex w-full items-center gap-2 rounded border border-teal-200 bg-teal-50 px-2.5 py-2 text-left hover:border-teal-400 disabled:opacity-50"
                  >
                    <Check size={14} className="shrink-0 text-teal-600" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-slate-900">
                        {displayName(c)}
                      </span>
                      {primaryPhone(c) || primaryEmail(c) ? (
                        <span className="block truncate text-[11px] text-slate-500">
                          {primaryPhone(c) || primaryEmail(c)}
                        </span>
                      ) : (
                        <span className="block text-[11px] text-slate-400">no phone or email yet</span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}

            <div className="relative mt-2.5">
              <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                className="input w-full pl-8 text-sm"
                placeholder={suggestions.length ? 'Or search for another' : 'Search contacts'}
                value={query}
                autoComplete="off"
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            {query.trim() ? (
              <ul className="mt-1 max-h-44 overflow-y-auto rounded border border-slate-200">
                {results.length ? results.map((c) => (
                  <li key={c.id}>
                    <button type="button" disabled={busy} onClick={() => link(c)}
                      className="w-full px-2.5 py-1.5 text-left hover:bg-slate-50 disabled:opacity-50">
                      <span className="block truncate text-sm text-slate-900">{displayName(c)}</span>
                      {primaryPhone(c) ? (
                        <span className="block text-[11px] text-slate-500">{primaryPhone(c)}</span>
                      ) : null}
                    </button>
                  </li>
                )) : (
                  <li className="px-2.5 py-2 text-xs text-slate-500">No contact matches that.</li>
                )}
              </ul>
            ) : null}

            <button
              type="button"
              onClick={() => {
                // Pre-filled from the case, so the common path is: open,
                // add the phone number, save, linked.
                setEditing({ lastName: clientName.split(',')[0]?.trim() || clientName,
                  firstName: clientName.split(',')[1]?.trim() || '', tags: ['Client'] });
                setOpen(false);
              }}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:border-teal-400 hover:text-teal-700"
            >
              <UserPlus size={13} /> Create a contact for {clientName}
            </button>

            {error ? (
              <p className="mt-2 flex items-start gap-1 text-xs text-rose-700">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {error}
              </p>
            ) : null}
          </div>
        ) : null}
      </span>

      {editing ? (
        <ContactEditor
          contact={editing}
          onCancel={() => setEditing(null)}
          onSaved={(saved) => { setEditing(null); if (saved?.id) link(saved); }}
        />
      ) : null}
    </>
  );
}
