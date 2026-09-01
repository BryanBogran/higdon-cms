'use client';

/**
 * Create or edit a contact — Filevine's dialog, tab for tab.
 *
 * Three tabs because the firm fills them at three different times: the name
 * and number at intake, the demographics when a demand is drafted, and the
 * associated projects never — that one is read.
 *
 * The dialog SAVES A REAL RECORD. Until now a client was free text on a
 * matter, so the same person on two cases was two strings that could disagree.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { X, Plus, Trash2, AlertTriangle, Building2, User } from 'lucide-react';
import { useData } from '@/lib/data/DataProvider';
import {
  emptyContact, displayName, validateContact, duplicateCandidates, pruneEntries,
  PHONE_LABELS, EMAIL_LABELS, ADDRESS_LABELS,
  CONTACT_ROLES, rolesOf, toggleRole,
} from '@/lib/domain/contact';
import { matterTitle } from '@/lib/domain/matter';

const TABS = ['Contact Info', 'Details', 'Associated Projects'];

export default function ContactEditor({ contact: initial, onSaved, onCancel }) {
  const { contacts, matters, createContact, updateContact } = useData();
  const [tab, setTab] = useState(TABS[0]);
  const [c, setC] = useState(() => ({ ...emptyContact(), ...(initial || {}) }));
  const [errors, setErrors] = useState([]);
  const [busy, setBusy] = useState(false);

  const set = (patch) => setC((prev) => ({ ...prev, ...patch }));
  const roster = useMemo(() => Object.values(contacts || {}), [contacts]);
  const dupes = useMemo(() => duplicateCandidates(roster, c), [roster, c]);

  const linked = useMemo(
    () => Object.entries(matters || {})
      .filter(([, m]) => m.clientContactId && m.clientContactId === c.id),
    [matters, c.id],
  );

  async function save() {
    const found = validateContact(c);
    setErrors(found);
    if (found.length) { setTab(TABS[0]); return; }

    setBusy(true);
    const clean = pruneEntries(c);
    const result = c.id
      ? await updateContact(c.id, clean)
      : await createContact(clean);
    setBusy(false);

    if (!result.ok) { setErrors([result.error || 'Could not save this contact.']); return; }
    onSaved?.(result.contact || { ...clean, id: result.id });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 overflow-y-auto">
      <div className="w-full max-w-4xl rounded-xl bg-surface shadow-xl my-6">
        {/* ---- header ---- */}
        <div className="flex items-start gap-4 p-5 border-b border-line">
          <span className="w-14 h-14 rounded-full bg-warn-solid-2 grid place-items-center shrink-0">
            {c.kind === 'company'
              ? <Building2 size={22} className="text-warn-ink-strong" />
              : <User size={22} className="text-warn-ink-strong" />}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold text-ink">
              {c.id ? 'Edit Contact' : 'New Contact'}
            </h2>
            {/*
              This chip used to read "Client", hard-coded, on every contact --
              including the orthopaedic clinic and the carrier. The directory
              is only useful if it can tell them apart, so the roles are real
              and editable here.

              Several at once on purpose: the treating doctor who later
              testifies is one person. See lib/domain/contact.js.
            */}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {CONTACT_ROLES.map((role) => {
                const on = rolesOf(c).includes(role);
                return (
                  <button
                    key={role}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setC((prev) => toggleRole(prev, role, !rolesOf(prev).includes(role)))}
                    className={`rounded border px-1.5 py-0.5 text-xs ${
                      on
                        ? 'border-accent-solid bg-accent-bg text-accent-ink font-medium'
                        : 'border-line text-ink-4 hover:border-ink-4 hover:text-ink-2'
                    }`}
                  >
                    {role}
                  </button>
                );
              })}
            </div>
            <div className="mt-1.5">
              <button
                type="button"
                onClick={() => set({ kind: c.kind === 'company' ? 'person' : 'company' })}
                className="text-xs text-ink-3 hover:text-ink-2"
              >
                {c.kind === 'company' ? 'Switch to a person' : 'This is a company'}
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" onClick={onCancel} className="px-3 py-1.5 text-sm text-ink-2 hover:text-ink">
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="px-4 py-1.5 rounded-lg bg-accent-solid text-white text-sm font-medium disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </div>

        {/* ---- tabs ---- */}
        <div className="flex gap-1 px-5 pt-3 border-b border-line">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                tab === t ? 'border-accent-solid text-accent-ink' : 'border-transparent text-ink-3 hover:text-ink-2'
              }`}
            >
              {t}{t === 'Associated Projects' && linked.length ? ` (${linked.length})` : ''}
            </button>
          ))}
        </div>

        <div className="p-5">
          {errors.length ? (
            <div className="mb-4 rounded-lg border border-danger-line bg-danger-bg p-3">
              {errors.map((e, i) => (
                <p key={i} className="text-sm text-danger-ink-strong flex items-center gap-1.5">
                  <AlertTriangle size={13} /> {e}
                </p>
              ))}
            </div>
          ) : null}

          {tab === 'Contact Info' ? (
            <ContactInfo c={c} set={set} dupes={dupes} />
          ) : tab === 'Details' ? (
            <Details c={c} set={set} />
          ) : (
            <Associated linked={linked} isNew={!c.id} />
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Field({ label, children, hint }) {
  const id = `f-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-ink-2 mb-1">{label}</label>
      {typeof children === 'function' ? children(id) : children}
      {hint ? <p className="mt-1 text-[11px] text-ink-4">{hint}</p> : null}
    </div>
  );
}

const Text = ({ id, value, onChange, placeholder, type = 'text' }) => (
  <input id={id} type={type} className="input w-full" value={value || ''} placeholder={placeholder}
    onChange={(e) => onChange(e.target.value)} />
);

function Toggle({ label, checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={Boolean(checked)}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2.5 rounded-lg border border-line px-3 py-2.5 w-full text-left hover:border-line-strong"
    >
      <span className={`w-9 h-5 rounded-full transition relative shrink-0 ${checked ? 'bg-accent-solid' : 'bg-line-strong'}`}>
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-surface transition-all ${checked ? 'left-4.5' : 'left-0.5'}`} />
      </span>
      <span className="text-sm text-ink-2">{label}</span>
    </button>
  );
}

/* ---- repeating groups ---- */

function Repeating({ title, entries, labels, fields, onChange, addLabel }) {
  const add = () => onChange([...(entries || []), { label: labels[0] }]);
  const patch = (i, p) => onChange(entries.map((e, n) => (n === i ? { ...e, ...p } : e)));
  const remove = (i) => onChange(entries.filter((_, n) => n !== i));

  return (
    <div>
      <h3 className="text-sm font-semibold text-ink mb-2">{title}</h3>
      <div className="space-y-2">
        {(entries || []).map((entry, i) => (
          <div key={i} className="flex items-start gap-2">
            <select
              className="input w-28 shrink-0"
              value={entry.label || labels[0]}
              onChange={(e) => patch(i, { label: e.target.value })}
              aria-label={`${title} type`}
            >
              {labels.map((l) => <option key={l}>{l}</option>)}
            </select>
            {fields.map((f) => (
              <input
                key={f.key}
                className={`input ${f.width || 'flex-1'}`}
                placeholder={f.placeholder}
                aria-label={f.placeholder}
                value={entry[f.key] || ''}
                onChange={(e) => patch(i, { [f.key]: e.target.value })}
              />
            ))}
            <button type="button" onClick={() => remove(i)} aria-label={`Remove this ${title.toLowerCase().replace(/e?s$/, '')}`}
              className="p-2 text-ink-4 hover:text-danger-ink shrink-0">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      <button type="button" onClick={add}
        className="mt-2 inline-flex items-center gap-1 text-sm text-accent-ink hover:underline">
        <Plus size={13} /> {addLabel}
      </button>
    </div>
  );
}

/* ---- tabs ---- */

function ContactInfo({ c, set, dupes }) {
  return (
    <div className="space-y-6">
      {dupes.length ? (
        <div className="rounded-lg border border-warn-line-2 bg-warn-bg p-3">
          <p className="text-sm text-warn-ink-strong flex items-start gap-1.5">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>
              <strong>{dupes.length === 1 ? 'A contact' : `${dupes.length} contacts`}</strong> already
              on file look like this one: {dupes.slice(0, 3).map((d) => displayName(d)).join(', ')}.
              Two clients can genuinely share a name — this is a check, not a block.
            </span>
          </p>
        </div>
      ) : null}

      {c.kind === 'company' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company Name">{(id) => <Text id={id} value={c.companyName} onChange={(v) => set({ companyName: v })} />}</Field>
          <Field label="Client Entity ID" hint="Unique ID for customer use">
            {(id) => <Text id={id} value={c.clientEntityId} onChange={(v) => set({ clientEntityId: v })} />}
          </Field>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="First Name">{(id) => <Text id={id} value={c.firstName} onChange={(v) => set({ firstName: v })} placeholder="First Name" />}</Field>
            <Field label="Middle Name">{(id) => <Text id={id} value={c.middleName} onChange={(v) => set({ middleName: v })} placeholder="Middle name" />}</Field>
            <Field label="Last Name">{(id) => <Text id={id} value={c.lastName} onChange={(v) => set({ lastName: v })} placeholder="Last name" />}</Field>
            <Field label="Client Entity ID" hint="Unique ID for customer use">
              {(id) => <Text id={id} value={c.clientEntityId} onChange={(v) => set({ clientEntityId: v })} />}
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-5">
            <Field label="Prefix">{(id) => <Text id={id} value={c.prefix} onChange={(v) => set({ prefix: v })} placeholder="e.g.: Mr., Ms." />}</Field>
            <Field label="Suffix">{(id) => <Text id={id} value={c.suffix} onChange={(v) => set({ suffix: v })} placeholder="e.g.: Jr., Sr." />}</Field>
            <Field label="Nickname">{(id) => <Text id={id} value={c.nickname} onChange={(v) => set({ nickname: v })} placeholder="Nickname" />}</Field>
            <Field label="Primary Language">{(id) => <Text id={id} value={c.primaryLanguage} onChange={(v) => set({ primaryLanguage: v })} />}</Field>
            <Field label="Date of Birth">{(id) => <Text id={id} type="date" value={c.dateOfBirth} onChange={(v) => set({ dateOfBirth: v })} />}</Field>
          </div>
        </>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        {c.kind !== 'company'
          ? <Field label="Company">{(id) => <Text id={id} value={c.companyName} onChange={(v) => set({ companyName: v })} />}</Field>
          : null}
        <Field label="Department">{(id) => <Text id={id} value={c.department} onChange={(v) => set({ department: v })} />}</Field>
        <Field label="Job Title">{(id) => <Text id={id} value={c.jobTitle} onChange={(v) => set({ jobTitle: v })} />}</Field>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 pt-2 border-t border-line-soft">
        <Repeating
          title="Phones" entries={c.phones} labels={PHONE_LABELS} addLabel="Add Phone"
          onChange={(phones) => set({ phones })}
          fields={[
            { key: 'value', placeholder: 'Enter a phone number' },
            { key: 'extension', placeholder: 'Extension', width: 'w-24' },
          ]}
        />
        <Repeating
          title="Emails" entries={c.emails} labels={EMAIL_LABELS} addLabel="Add Email"
          onChange={(emails) => set({ emails })}
          fields={[{ key: 'value', placeholder: 'Enter an email address' }]}
        />
      </div>

      <div className="pt-2 border-t border-line-soft">
        <Repeating
          title="Addresses" entries={c.addresses} labels={ADDRESS_LABELS} addLabel="Add Address"
          onChange={(addresses) => set({ addresses })}
          fields={[
            { key: 'line1', placeholder: 'Street' },
            { key: 'city', placeholder: 'City', width: 'w-40' },
            { key: 'state', placeholder: 'State', width: 'w-20' },
            { key: 'postal', placeholder: 'ZIP', width: 'w-24' },
          ]}
        />
      </div>
    </div>
  );
}

function Details({ c, set }) {
  return (
    <div className="space-y-6">
      <Field label="Salutation" hint={'Letter salutation line, like: "Dear Mr/Ms/Dr/Judge or First Last,"'}>
        {(id) => <Text id={id} value={c.salutation} onChange={(v) => set({ salutation: v })} />}
      </Field>

      <div className="grid gap-3 sm:grid-cols-3">
        <Toggle label="Can Text?" checked={c.canText} onChange={(v) => set({ canText: v })} />
        <Toggle label="Can Remarket?" checked={c.canRemarket} onChange={(v) => set({ canRemarket: v })} />
        <Toggle label="Is a Minor?" checked={c.isMinor} onChange={(v) => set({ isMinor: v })} />
      </div>

      {c.isMinor ? (
        <p className="text-sm text-warn-ink-strong bg-warn-bg border border-warn-line rounded-lg p-3 flex items-start gap-1.5">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          A minor&apos;s limitations period does not run the way an adult&apos;s does. The SOL on any
          case for this client needs the attorney to set it deliberately.
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Gender">
          {(id) => (
            <select id={id} className="input w-full" value={c.gender || ''} onChange={(e) => set({ gender: e.target.value })}>
              <option value="">— Select an Option —</option>
              {['Female', 'Male', 'Non-binary', 'Prefer not to say', 'Other'].map((o) => <option key={o}>{o}</option>)}
            </select>
          )}
        </Field>
        <Field label="Marital Status">
          {(id) => (
            <select id={id} className="input w-full" value={c.maritalStatus || ''} onChange={(e) => set({ maritalStatus: e.target.value })}>
              <option value="">— Select an Option —</option>
              {['Single', 'Married', 'Divorced', 'Widowed', 'Separated', 'Domestic Partnership'].map((o) => <option key={o}>{o}</option>)}
            </select>
          )}
        </Field>
        <Field label="Language">{(id) => <Text id={id} value={c.primaryLanguage} onChange={(v) => set({ primaryLanguage: v })} />}</Field>
        <Field label="Driver License Number">{(id) => <Text id={id} value={c.driverLicense} onChange={(v) => set({ driverLicense: v })} />}</Field>
        <Field label="Fiduciary">{(id) => <Text id={id} value={c.fiduciary} onChange={(v) => set({ fiduciary: v })} />}</Field>
        <Field
          label="Social Security Number"
          hint="Needed for Medicare reporting and lien resolution. Kept out of the audit log; every signed-in user can read it."
        >
          {(id) => <Text id={id} value={c.ssn} onChange={(v) => set({ ssn: v })} placeholder="123-45-6789" />}
        </Field>
      </div>

      <Field label="Notes">
        {(id) => (
          <textarea id={id} className="input w-full min-h-24" value={c.notes || ''}
            onChange={(e) => set({ notes: e.target.value })} />
        )}
      </Field>
    </div>
  );
}

function Associated({ linked, isNew }) {
  if (isNew) {
    return <p className="text-sm text-ink-3">Save this contact and it can be added to a case.</p>;
  }
  if (!linked.length) {
    return (
      <div className="space-y-2 text-sm text-ink-3">
        <p>This contact is not the client on any case.</p>
        {/*
          Say what is NOT being counted. A provider on thirty cases would also
          land here, and "no cases" would read as an answer when it is really
          "the question cannot be asked yet": a case's provider and adjuster
          rows store a NAME, not a link to this record. Only the client link is
          a real reference. Same rule as the Drive review queue -- never render
          "we could not ask" as "the answer is none".
        */}
        <p className="text-xs text-ink-4">
          Only the client link is counted. A provider, adjuster or defence firm named on a case is
          stored as text on that row, so it cannot be traced back here yet.
        </p>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-line-soft">
      {linked.map(([id, m]) => (
        <li key={id} className="py-2.5 flex items-center justify-between">
          <Link href={`/matters/${id}`} className="text-sm font-medium text-accent-ink hover:underline">
            {matterTitle(m)}
          </Link>
          <span className="text-xs text-ink-3">{m.values?.status || ''}</span>
        </li>
      ))}
    </ul>
  );
}
