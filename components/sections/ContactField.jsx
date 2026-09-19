'use client';

/**
 * A contact on a section row — the insurance carrier, the treating provider,
 * the person being treated.
 *
 * ── What was wrong ───────────────────────────────────────────────────────
 *
 * This stored A NAME. Just the string, with a datalist of names already seen
 * elsewhere. It never recorded WHICH contact, so it had no phone number, no
 * email and no address to show — the carrier's claims line lived on the
 * Contacts page and the person looking at the policy could not see it.
 *
 * Filevine shows a card: name, phones, email, address, role. That is not
 * decoration. Somebody on the phone to an adjuster needs the claims number
 * without leaving the case.
 *
 * ── A stored name is not a link, and this does not pretend otherwise ─────
 *
 * Picking from the list now stores `{ id, name }` — the id to look the record
 * up with, the name as a snapshot so a deleted contact still reads as
 * something rather than vanishing.
 *
 * ⚠️ LEGACY VALUES ARE RESOLVED BY NAME, FOR DISPLAY ONLY. Hundreds of rows
 * already carry a typed name. Where exactly one contact matches it, the card
 * is shown — so the firm gets the carrier's details on rows nobody will ever
 * go back and re-link. Where NOTHING matches, or several do, the name is left
 * exactly as typed: guessing between two contacts called "Allstate" would
 * attach a case to the wrong adjuster, and a name nobody recognises is still
 * the only record of what somebody wrote.
 *
 * Nothing is rewritten in the database by rendering. A legacy row is upgraded
 * only when a person picks from the list.
 */

import { useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { User, UserPlus, X, Phone, Mail, MapPin, Loader2 } from 'lucide-react';
import { useData } from '@/lib/data/DataProvider';
import {
  displayName, primaryPhone, primaryEmail, rolesOf, matchContactsByName, emptyContact,
} from '@/lib/domain/contact';

/** Two letters from a name, for the avatar. */
function initialsOf(name) {
  const parts = String(name || '').replace(/[^\p{L}\s,]/gu, ' ').split(/[\s,]+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

/** Stable colour per contact, so a card is recognisable before it is read. */
const SWATCHES = ['bg-violet-500', 'bg-sky-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-indigo-500'];
function swatch(seed) {
  const s = String(seed || '');
  let n = 0;
  for (let i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) >>> 0;
  return SWATCHES[n % SWATCHES.length];
}

/**
 * Turn what somebody typed into a contact record.
 *
 * `kind` decides the shape: an insurance carrier or a hospital is a COMPANY
 * and its name belongs in companyName, not split into a first and a last.
 * Splitting "Memorial Hermann Southwest" into a forename and a surname is how
 * a directory of providers becomes unsearchable.
 *
 * A person's name is split the way the firm writes one -- surname first, comma
 * separated. Without a comma the last word is taken as the surname, which is
 * right far more often than it is wrong and is visible and editable the moment
 * the card appears.
 */
function draftFrom(text, { kind = 'person', role = '' } = {}) {
  const name = String(text || '').trim();
  const draft = { ...emptyContact(), kind, tags: role ? [role] : [] };

  if (kind === 'company') {
    draft.companyName = name;
    return draft;
  }
  if (name.includes(',')) {
    const [last, ...rest] = name.split(',');
    draft.lastName = last.trim();
    draft.firstName = rest.join(',').trim();
    return draft;
  }
  const parts = name.split(/\s+/).filter(Boolean);
  draft.lastName = parts.length > 1 ? parts[parts.length - 1] : name;
  draft.firstName = parts.length > 1 ? parts.slice(0, -1).join(' ') : '';
  return draft;
}

export default function ContactField({ value, onChange, field }) {
  const { contacts, createContact } = useData();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  const listId = useId();
  const [editing, setEditing] = useState(false);

  // Both shapes: a bare name from before this existed, and { id, name } now.
  const stored = typeof value === 'object' && value
    ? { id: value.id || '', name: value.name || value.fullname || '' }
    : { id: '', name: value ?? '' };

  const live = Object.values(contacts || {}).filter((c) => c && !c.deletedAt);

  /*
   * The record behind this value, if there is one we can be sure of.
   * By id first -- that is a link. Then by name, but ONLY when exactly one
   * contact matches; see the note at the top.
   */
  const linked = useMemo(() => {
    if (stored.id && contacts?.[stored.id] && !contacts[stored.id].deletedAt) {
      return contacts[stored.id];
    }
    if (!stored.name) return null;
    const hits = matchContactsByName(live, stored.name);
    return hits.length === 1 ? hits[0] : null;
  }, [stored.id, stored.name, contacts, live]);

  const names = useMemo(() => {
    const seen = new Set();
    for (const c of live) {
      const n = displayName(c);
      if (n) seen.add(n);
    }
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [live]);

  /** Typing stores a plain name; matching one exactly upgrades it to a link. */
  function commit(text) {
    const name = String(text || '').trim();
    if (!name) return onChange('');
    const hits = matchContactsByName(live, name);
    return onChange(hits.length === 1 ? { id: hits[0].id, name: displayName(hits[0]) } : name);
  }

  /**
   * Make the contact from what is typed, and link it — without leaving the
   * case.
   *
   * The firm's objection to the Contacts page was not that it is bad, it is
   * that a carrier's name is typed while looking at a policy, and going
   * somewhere else to record it means it does not get recorded. So the
   * record is created here with the one thing that is known — the name —
   * tagged with the role the field implies, and linked immediately.
   *
   * ⚠️ IT DOES NOT COLLECT A PHONE NUMBER, deliberately. A required second
   * step is how a quick action stops being quick; the card appears with a
   * link straight to the full record, and the details get filled in when
   * somebody has them. A contact with a name is worth more than no contact.
   */
  async function quickCreate() {
    const text = String(inputRef.current?.value || '').trim();
    if (!text || saving) return;

    // Already there under that name? Link it rather than making a second.
    const hits = matchContactsByName(live, text);
    if (hits.length === 1) {
      onChange({ id: hits[0].id, name: displayName(hits[0]) });
      setEditing(false);
      return;
    }

    setSaving(true);
    setError('');
    const result = await createContact(draftFrom(text, {
      kind: field?.contactKind || 'person',
      role: field?.contactRole || '',
    }));
    setSaving(false);

    if (!result?.ok) {
      setError(result?.error || 'Could not create that contact.');
      return;
    }
    onChange({ id: result.id, name: displayName(result.contact) });
    setEditing(false);
  }

  /* ---------------- the card ---------------- */
  if (linked && !editing) {
    const name = displayName(linked);
    const phone = primaryPhone(linked);
    const email = primaryEmail(linked);
    const address = linked.addresses?.[0]?.value || '';
    const role = rolesOf(linked)[0] || '';
    const more = Math.max(0, (linked.phones?.length || 0) - 1);

    return (
      <div className="rounded-lg border border-line bg-surface p-2.5">
        <div className="flex items-start gap-2">
          <span
            className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white ${swatch(linked.id)}`}
          >
            {initialsOf(name)}
          </span>

          <div className="min-w-0 flex-1">
            <Link
              href={`/contacts?id=${linked.id}`}
              className="block truncate text-sm font-semibold text-accent-ink hover:underline"
            >
              {name}
            </Link>

            {phone || email ? (
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-3">
                {phone ? (
                  <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} className="flex items-center gap-1 hover:underline">
                    <Phone size={11} /> {phone}
                    {more ? <span className="text-ink-4">(+{more} more)</span> : null}
                  </a>
                ) : null}
                {email ? (
                  <a href={`mailto:${email}`} className="flex items-center gap-1 truncate hover:underline">
                    <Mail size={11} /> <span className="truncate">{email}</span>
                  </a>
                ) : null}
              </p>
            ) : null}

            {address ? (
              <p className="mt-0.5 flex items-start gap-1 text-xs text-ink-4">
                <MapPin size={11} className="mt-0.5 shrink-0" />
                <span className="truncate">{address}</span>
              </p>
            ) : null}

            {role ? (
              <span className="mt-1 inline-block rounded bg-raised px-1.5 py-0.5 text-[10px] text-ink-3">
                {role}
              </span>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => { setEditing(true); }}
            title="Change or clear this contact"
            className="shrink-0 p-0.5 text-ink-4 hover:text-danger-ink"
          >
            <X size={13} />
          </button>
        </div>
      </div>
    );
  }

  /* ---------------- the input ---------------- */
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <div className="relative min-w-0 flex-1">
          <User size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-4" />
          <input
            ref={inputRef}
            type="text"
            className="input pl-8"
            placeholder="Name"
            autoFocus={editing}
            list={names.length ? listId : undefined}
            /*
             * The VALUE is the tooltip when there is one, and the help text
             * only when the field is empty. No column width fits every
             * provider name, so a clipped name has to be recoverable without
             * clicking in and pressing End. Hovering is that.
             */
            title={stored.name || (names.length
              ? 'Suggestions come from Contacts. A name that is not there can still be typed.'
              : 'No contacts yet — add providers and carriers on the Contacts page and they will be suggested here.')}
            defaultValue={stored.name}
            /*
             * ⚠️ onMouseDown, not onClick, on the button beside this. Blur
             * fires first otherwise, and `commit` would store the plain name
             * and re-render before the click ever lands — so the button would
             * appear to do nothing.
             */
            onBlur={(e) => { commit(e.target.value); setEditing(false); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              // Escape abandons the edit without changing what is stored.
              if (e.key === 'Escape') { e.currentTarget.value = stored.name; e.currentTarget.blur(); }
            }}
          />
          {names.length ? (
            <datalist id={listId}>
              {names.map((n) => <option key={n} value={n} />)}
            </datalist>
          ) : null}
        </div>

        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); quickCreate(); }}
          disabled={saving}
          title={`Create a contact from this name${field?.contactRole ? ` as a ${field.contactRole}` : ''}, and link it`}
          className="shrink-0 rounded-lg border border-line-strong p-2 text-ink-4 transition hover:border-accent-solid hover:text-accent-ink disabled:opacity-40"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
        </button>
      </div>

      {error ? <p className="mt-1 text-xs text-danger-ink">{error}</p> : null}
    </div>
  );
}
