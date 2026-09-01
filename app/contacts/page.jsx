'use client';

/**
 * Contacts — the firm's directory.
 *
 * Everyone a case touches lives here once: clients, medical providers,
 * insurance companies, adjusters, defence counsel, experts. The point is
 * REUSE. "Northside Orthopaedics" was typed into forty provider rows across
 * thirty cases, forty separate strings, spelled six ways -- so the firm could
 * not answer "which clinics do we send people to", could not correct a fax
 * number once, and could not tell that two of those spellings were the same
 * building.
 *
 * ── What this page is not ─────────────────────────────────────────────────
 *
 * It is not a CRM. There is no pipeline, no activity per contact, no merge
 * tool. Merging in particular is deliberately absent: it is destructive and
 * irreversible, and the right time to build it is after the firm has seen its
 * own duplicates, not before. Until then the editor WARNS about look-alikes
 * and a person decides.
 *
 * ── Roles, not types ──────────────────────────────────────────────────────
 *
 * A contact carries a list of roles rather than one type, because the same
 * record genuinely holds several. See lib/domain/contact.js. They live in the
 * `tags` column 008 already created, so this page needs no migration.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, Plus, X, Users, Building2, User, Phone, Mail, Briefcase } from 'lucide-react';
import { useData } from '@/lib/data/DataProvider';
import ContactEditor from '@/components/contacts/ContactEditor';
import {
  browseContacts, displayName, rolesOf, freeTagsOf, roleCounts, CONTACT_ROLES,
} from '@/lib/domain/contact';
import { matterTitle } from '@/lib/domain/matter';

/** Colour by role so a list of 300 can be read by shape, not word by word. */
const ROLE_STYLE = {
  'Client': 'bg-accent-bg text-accent-ink border-accent-line',
  'Medical Provider': 'bg-danger-bg text-danger-ink border-danger-line',
  'Insurance Company': 'bg-info-bg text-info-ink border-info-line',
  'Adjuster': 'bg-cat-indigo-bg text-cat-indigo-ink border-cat-indigo-line',
  'Attorney': 'bg-cat-violet-bg text-cat-violet-ink border-cat-violet-line',
  'Expert': 'bg-warn-bg text-warn-ink-strong border-warn-line',
  'Witness': 'bg-cat-lime-bg text-cat-lime-ink border-cat-lime-line',
  'Court': 'bg-raised text-ink-2 border-line-strong',
  'Employer': 'bg-alert-bg text-alert-ink border-alert-line',
  'Other': 'bg-canvas text-ink-2 border-line',
};

function RoleChip({ role }) {
  return (
    <span className={`inline-block rounded border px-1.5 py-0.5 text-[11px] font-medium ${ROLE_STYLE[role] || ROLE_STYLE.Other}`}>
      {role}
    </span>
  );
}

export default function ContactsPage() {
  const { contacts, matters, loaded } = useData();

  const [query, setQuery] = useState('');
  const [role, setRole] = useState('');
  const [editing, setEditing] = useState(null);

  const roster = useMemo(() => Object.values(contacts || {}), [contacts]);
  const rows = useMemo(() => browseContacts(roster, { query, role }), [roster, query, role]);
  const { counts, untagged } = useMemo(() => roleCounts(roster), [roster]);

  /*
   * Cases per contact, computed once for the whole list rather than per row.
   * Per row it is O(contacts × matters) -- 300 × 256 on this firm's data, on
   * every keystroke in the search box.
   */
  const casesByContact = useMemo(() => {
    const map = new Map();
    for (const [id, m] of Object.entries(matters || {})) {
      const cid = m?.clientContactId;
      if (!cid) continue;
      if (!map.has(cid)) map.set(cid, []);
      map.get(cid).push({ id, matter: m });
    }
    return map;
  }, [matters]);

  const shownRoles = CONTACT_ROLES.filter((r) => counts[r] > 0);

  return (
    <div>
      <div className="border-b border-line bg-surface">
        <div className="flex items-center justify-between px-6 py-5">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-ink">
            <Users size={22} className="text-ink-4" /> Contacts
          </h1>
          <button
            type="button"
            onClick={() => setEditing({})}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent-solid text-white text-sm font-semibold hover:bg-accent-solid-2"
          >
            <Plus size={16} /> New Contact
          </button>
        </div>

        <div className="px-6 pb-4 space-y-3">
          <div className="relative max-w-md">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-4 pointer-events-none" />
            <input
              className="input w-full pl-9"
              placeholder="Search by name, company, phone or email"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search contacts"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-ink-4 hover:text-ink-2"
              >
                <X size={14} />
              </button>
            ) : null}
          </div>

          {/* Only roles that exist are offered. A filter that can only ever
              return nothing is a dead control. */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setRole('')}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                role === '' ? 'bg-primary text-white border-primary' : 'bg-surface text-ink-2 border-line-strong hover:border-ink-4'
              }`}
            >
              All {roster.filter((c) => !c.deletedAt).length}
            </button>
            {shownRoles.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(role === r ? '' : r)}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  role === r ? 'bg-primary text-white border-primary' : 'bg-surface text-ink-2 border-line-strong hover:border-ink-4'
                }`}
              >
                {r} {counts[r]}
              </button>
            ))}
            {untagged ? (
              <span className="text-xs text-ink-4">
                {untagged} with no role — open one to tag it.
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="px-6 py-5">
        {!loaded ? (
          <p className="text-sm text-ink-4">Loading…</p>
        ) : !roster.length ? (
          <div className="rounded-xl border border-dashed border-line-strong p-10 text-center">
            <p className="text-ink-2 font-medium">No contacts yet.</p>
            <p className="mt-1 text-sm text-ink-3">
              A client added on the Create a Project panel lands here automatically. Providers,
              carriers and adjusters are added with New Contact.
            </p>
          </div>
        ) : !rows.length ? (
          <p className="text-sm text-ink-3">
            Nothing matches{query ? ` “${query.trim()}”` : ''}{role ? ` in ${role}` : ''}.{' '}
            <button type="button" onClick={() => { setQuery(''); setRole(''); }} className="text-accent-ink hover:underline">
              Clear the filters
            </button>
          </p>
        ) : (
          <>
            <p className="mb-2 text-sm text-ink-3">
              {rows.length} {rows.length === 1 ? 'contact' : 'contacts'}
            </p>
            <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line-soft bg-canvas text-left">
                    <th scope="col" className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-4">Name</th>
                    <th scope="col" className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-4">Roles</th>
                    <th scope="col" className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-4">Phone</th>
                    <th scope="col" className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-4">Email</th>
                    <th scope="col" className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-4">Cases</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => {
                    const cases = casesByContact.get(c.id) || [];
                    const roles = rolesOf(c);
                    const extra = freeTagsOf(c);
                    return (
                      <tr key={c.id} className="border-b border-line-soft last:border-0 hover:bg-hover/60">
                        <td className="px-4 py-2.5">
                          <button
                            type="button"
                            onClick={() => setEditing(c)}
                            className="flex items-center gap-2 text-left"
                          >
                            <span className="w-7 h-7 rounded-full bg-warn-solid-2 grid place-items-center shrink-0">
                              {c.kind === 'company'
                                ? <Building2 size={14} className="text-warn-ink-strong" />
                                : <User size={14} className="text-warn-ink-strong" />}
                            </span>
                            <span>
                              <span className="block font-medium text-accent-ink hover:underline">
                                {displayName(c) || 'Unnamed'}
                              </span>
                              {c.jobTitle || c.department ? (
                                <span className="flex items-center gap-1 text-[11px] text-ink-4">
                                  <Briefcase size={10} /> {[c.jobTitle, c.department].filter(Boolean).join(' · ')}
                                </span>
                              ) : null}
                            </span>
                          </button>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="flex flex-wrap gap-1">
                            {roles.map((r) => <RoleChip key={r} role={r} />)}
                            {extra.map((t) => (
                              <span key={t} className="inline-block rounded border border-line bg-canvas px-1.5 py-0.5 text-[11px] text-ink-3">
                                {t}
                              </span>
                            ))}
                            {!roles.length && !extra.length ? <span className="text-xs text-ink-4">—</span> : null}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-ink-2 whitespace-nowrap">
                          {c.phones?.[0]?.value ? (
                            <a href={`tel:${c.phones[0].value}`} className="flex items-center gap-1 hover:underline">
                              <Phone size={12} className="text-ink-4" /> {c.phones[0].value}
                            </a>
                          ) : <span className="text-ink-4">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-ink-2">
                          {c.emails?.[0]?.value ? (
                            <a href={`mailto:${c.emails[0].value}`} className="flex items-center gap-1 hover:underline truncate">
                              <Mail size={12} className="text-ink-4 shrink-0" /> {c.emails[0].value}
                            </a>
                          ) : <span className="text-ink-4">—</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          {/*
                            Only cases where this contact is THE CLIENT. A
                            provider's cases are not countable yet: section rows
                            store a provider's name as text, not a link, so
                            there is nothing to count. Saying "0" there would be
                            a wrong answer rather than a missing one, so the
                            column shows a dash and the editor says why.
                          */}
                          {cases.length ? (
                            <span className="flex flex-col gap-0.5">
                              {cases.slice(0, 3).map(({ id, matter }) => (
                                <Link key={id} href={`/matters/${id}`} className="text-xs text-accent-ink hover:underline truncate">
                                  {matterTitle(matter)}
                                </Link>
                              ))}
                              {cases.length > 3 ? (
                                <span className="text-[11px] text-ink-4">+{cases.length - 3} more</span>
                              ) : null}
                            </span>
                          ) : <span className="text-ink-4">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {editing ? (
        <ContactEditor
          contact={editing}
          onCancel={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
