'use client';

/**
 * THE MULTIPLIER.
 *
 * Most of the firm's sections are the same three things in different
 * arrangements: a field group, one or more repeating row collections, and a
 * checklist. One renderer driven by the registry means adding a section is
 * configuration, not a sprint — which is what turns a ~450-hour build into a
 * ~250-hour one.
 *
 * Sections start here and graduate to a purpose-built component only when real
 * use argues for it.
 *
 * ── Why a collection carries its own storage key ──────────────────────────
 *
 * Medicals is one tab over two tables: a provider-level ledger and a
 * visit-level chronology. Those were two separate sections until the firm's
 * real rail turned out to have one, and their rows are already in the database
 * under `meds` and `med-chron`.
 *
 * So a collection declares `storageKey` and reads and writes under THAT, not
 * under the section key. Merging two sections into one tab therefore moves no
 * rows at all — the same records simply appear together. A collection with no
 * `storageKey` falls back to the section key, which is every other section.
 */

import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import FieldInput from './FieldInput';
import ChecklistItems from './ChecklistItems';
import { useData } from '@/lib/data/DataProvider';
import { FIELD_BY_KEY } from '@/lib/domain/fields';
import { columnMinWidth } from '@/lib/sections/columns';

function money(n) {
  const num = parseFloat(String(n ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(num) ? num : 0;
}

/** One repeating table. Its own draft row, so two on a page cannot collide. */
function Collection({ matterId, sectionKey, collection, uploadFolder }) {
  const { sectionState, addSectionRow, updateSectionRow, deleteSectionRow } = useData();
  const storageKey = collection.storageKey || sectionKey;
  const state = sectionState(matterId, storageKey);
  const [draft, setDraft] = useState({});

  const cols = collection.columns || [];
  const total = useMemo(() => {
    if (!collection.total) return null;
    return state.rows.reduce((sum, r) => sum + money(r[collection.total]), 0);
  }, [state.rows, collection]);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
        <h2 className="font-semibold text-slate-900">{collection.label}</h2>
        <span className="text-sm text-slate-500">
          {state.rows.length} {state.rows.length === 1 ? 'entry' : 'entries'}
          {total !== null ? ` · $${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : ''}
        </span>
      </div>

      {state.rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                {cols.map((c) => (
                  <th key={c.key} className="text-left px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 whitespace-nowrap">
                    {c.label}
                  </th>
                ))}
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {state.rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-50 last:border-0">
                  {cols.map((c) => (
                    /*
                     * The minimum comes from the column TYPE, not one number
                     * for all of them. An auto-layout table shares width by
                     * content, so a flat 130px let the two textareas take what
                     * they wanted and collapsed every name column to the floor
                     * -- rendering "Aguilar, Karen" as "Aguilar, Karer" with
                     * the rest hidden under the next input.
                     */
                    <td
                      key={c.key}
                      className="px-3 py-2 align-top"
                      style={{ minWidth: columnMinWidth(c.type) }}
                    >
                      <FieldInput
                        field={{ ...c, inputs: collection.calculated?.[c.key]?.inputs }}
                        value={row[c.key]}
                        row={row}
                        matterId={matterId}
                        uploadFolder={uploadFolder}
                        onChange={(val) => updateSectionRow(matterId, storageKey, row.id, { [c.key]: val })}
                      />
                    </td>
                  ))}
                  <td className="px-2 align-middle">
                    <button
                      onClick={() => deleteSectionRow(matterId, storageKey, row.id)}
                      className="p-1.5 text-slate-300 hover:text-red-600"
                      title="Delete row"
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-5 py-8 text-center text-sm text-slate-400">No entries yet.</p>
      )}

      <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/60 flex flex-wrap items-end gap-3">
        {/*
          Every column, not the first three. It used to slice(0, 3), so on
          Insurance you could enter carrier, coverage and policy number but not
          limits, adjuster or claim number -- you had to add a blank row and
          fill the rest in the table.
        */}
        {cols
          // Derived and attachment columns are skipped: one is computed, the
          // other needs a saved row to hang off.
          .filter((c) => c.type !== 'calculated' && c.type !== 'attachments')
          .map((c) => (
            <div
              key={c.key}
              className={c.type === 'textarea' ? 'flex-1' : ''}
              style={{ minWidth: columnMinWidth(c.type) }}
            >
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
                {c.label}
              </label>
              <FieldInput
                field={c}
                value={draft[c.key]}
                matterId={matterId}
                uploadFolder={uploadFolder}
                onChange={(val) => setDraft((d) => ({ ...d, [c.key]: val }))}
              />
            </div>
          ))}
        <button
          onClick={() => {
            addSectionRow(matterId, storageKey, draft);
            setDraft({});
          }}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800"
        >
          <Plus size={15} /> Add
        </button>
      </div>
    </div>
  );
}

/**
 * A headed run of fields.
 *
 * Filevine's real sections are not flat. Intake alone has eight of these —
 * Personal Info, Accident Information, Injuries, Priors, Economic Damages,
 * Non Economic Damages, Wrap-Up, Additional Info — and a paralegal navigates
 * to a heading, not to the eleventh field down an undifferentiated list.
 *
 * `full: true` on a field makes it span both columns, which is what long text
 * needs and what the printed sheets show.
 */
/**
 * A section field whose key is ALSO a matter-level field must read and write
 * the matter, not this section's bag of section data.
 *
 * The intake interview asks for the SOL, and `lib/domain/fields.js` also
 * defines `sol` as a matter field, because the deadline chain, the calendar,
 * the dashboard countdown and the projects table all read `matter.values.sol`.
 * Routing every field to setSectionField meant the SOL typed on the Intake tab
 * landed in matter_section_data instead, where nothing that computes a
 * deadline ever looks -- so the tab accepted the single most important date on
 * a PI file and silently dropped it, while an identically labelled field on
 * Case Info worked. Two fields, same label, one of them inert.
 *
 * Deciding this from FIELD_BY_KEY rather than a flag in the registry means a
 * field added to a section later is wired up by virtue of sharing the key, and
 * cannot repeat the failure by omission.
 *
 * yesnoDoc fields are excluded: their value is a {done, docUrl, note, date}
 * object owned by the checklist, not a scalar, and they reach the matter
 * through setChecklistItem.
 */
function matterBackedField(field) {
  const mf = FIELD_BY_KEY[field.key];
  return mf && mf.type !== 'yesnoDoc' ? mf : null;
}

function FieldGroup({
  matterId, matter, sectionKey, title, fields, state,
  setSectionField, updateMatterField, uploadFolder,
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
      {title ? (
        <div className="px-5 py-3 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900">{title}</h2>
        </div>
      ) : null}
      <div className="p-5 grid gap-4 sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f.key} className={f.type === 'textarea' || f.full ? 'sm:col-span-2' : ''}>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
              {f.label}
            </label>
            <FieldInput
              field={f}
              value={matterBackedField(f) ? matter?.values?.[f.key] : state.fields[f.key]}
              matterId={matterId}
              uploadFolder={uploadFolder}
              onChange={(val) => (matterBackedField(f)
                ? updateMatterField(matterId, f.key, val)
                : setSectionField(matterId, sectionKey, f.key, val))}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function GenericSection({ matterId, matter, section }) {
  const { sectionState, setSectionField, updateMatterField } = useData();
  const state = sectionState(matterId, section.key);

  // `collections` is the general form; `collection` is the singular shorthand
  // every section but Medicals uses.
  const collections = section.collections || (section.collection ? [section.collection] : []);

  return (
    <div className="space-y-6">
      {section.description ? <p className="text-sm text-slate-500">{section.description}</p> : null}

      {/*
        Checklist items belonging to this section — Served under Pleading, the
        four discovery items under Discovery, and so on. Which items those are
        is decided by lib/domain/fields.js, not here.
      */}
      {section.checklistSection ? (
        <ChecklistItems
          matterId={matterId}
          matter={matter}
          sectionLabel={section.checklistSection}
          title={`${section.label} checklist`}
          uploadFolder={section.uploadFolder}
        />
      ) : null}

      {/* `fields` is the flat shorthand; `groups` is the general form. */}
      {section.fields ? (
        <FieldGroup
          matterId={matterId}
          matter={matter}
          sectionKey={section.key}
          title={section.label}
          fields={section.fields}
          state={state}
          setSectionField={setSectionField}
          updateMatterField={updateMatterField}
          uploadFolder={section.uploadFolder}
        />
      ) : null}

      {(section.groups || []).map((g) => (
        <FieldGroup
          key={g.title || 'main'}
          matterId={matterId}
          matter={matter}
          sectionKey={section.key}
          title={g.title}
          fields={g.fields}
          state={state}
          setSectionField={setSectionField}
          updateMatterField={updateMatterField}
          uploadFolder={section.uploadFolder}
        />
      ))}

      {collections.map((c) => (
        <Collection
          key={c.storageKey || section.key}
          matterId={matterId}
          sectionKey={section.key}
          collection={c}
          uploadFolder={section.uploadFolder}
        />
      ))}

      {section.verified ? (
        <p className="text-xs text-slate-400">
          Fields captured from the firm&apos;s own Filevine configuration.
        </p>
      ) : (
        <p className="text-xs text-amber-700">
          These fields are a first pass, not yet confirmed against Filevine — capture a matter
          that has data in this section and they can be replaced with the real ones.
        </p>
      )}
    </div>
  );
}
