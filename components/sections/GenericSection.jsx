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

import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, LayoutGrid, Table2 } from 'lucide-react';
import ItemCard from './items/ItemCard';
import ItemEditor from './items/ItemEditor';
import { usesCards, itemLayout } from '@/lib/sections/layout';
import { DocButtons } from './GenerateDoc';
import { templatesFor } from '@/lib/domain/docgen';
import FieldInput from './FieldInput';
import ChecklistItems from './ChecklistItems';
import { useData } from '@/lib/data/DataProvider';
import { FIELD_BY_KEY } from '@/lib/domain/fields';
import { columnMinWidth } from '@/lib/sections/columns';

function money(n) {
  const num = parseFloat(String(n ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(num) ? num : 0;
}

/**
 * Cards or table, remembered per section in this browser -- as Filevine
 * remembers the view per section. Read after mount, not during render, so the
 * server's HTML and the first client render agree. Storage can throw (private
 * windows, blocked site data); the default view is then simply used.
 */
function useRememberedView(storageKey, fallback) {
  const [view, setView] = useState(fallback);
  const key = `hlcms:view:${storageKey}`;
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(key);
      if (saved === 'cards' || saved === 'table') setView(saved);
    } catch { /* keep the default */ }
  }, [key]);
  const choose = (next) => {
    setView(next);
    try { window.localStorage.setItem(key, next); } catch { /* not remembered, still switched */ }
  };
  return [view, choose];
}

/** One repeating table. Its own draft row, so two on a page cannot collide. */
function Collection({ matterId, sectionKey, collection, uploadFolder }) {
  const { sectionState, addSectionRow, updateSectionRow, deleteSectionRow } = useData();
  const storageKey = collection.storageKey || sectionKey;
  const state = sectionState(matterId, storageKey);
  const [draft, setDraft] = useState({});

  const cols = collection.columns || [];

  /*
   * Wide tables read as Filevine-style cards and edit in a drawer; see
   * lib/sections/layout.js for why. Narrow ones already fit and stay tables.
   * The table is kept for wide ones too, one click away, for comparing
   * amounts down a column.
   */
  const wide = usesCards(collection);
  const [view, setView] = useRememberedView(storageKey, wide ? 'cards' : 'table');
  const layout = useMemo(() => itemLayout(collection), [collection]);
  const noun = collection.item?.noun || 'entry';
  // The row the drawer is open on: a row id, 'new' for the add form, or null.
  const [openId, setOpenId] = useState(null);
  const openRow = openId && openId !== 'new' ? state.rows.find((r) => r.id === openId) : null;
  // Somebody else deleted it while it was open: close rather than edit a ghost.
  useEffect(() => {
    if (openId && openId !== 'new' && !openRow) setOpenId(null);
  }, [openId, openRow]);
  // Keyed on storageKey, not the section key: a row's documents belong to the
  // table the rows actually live in. See the note at the top of this file.
  const docTemplates = templatesFor(storageKey);
  const total = useMemo(() => {
    if (!collection.total) return null;
    return state.rows.reduce((sum, r) => sum + money(r[collection.total]), 0);
  }, [state.rows, collection]);

  return (
    <div className="bg-surface rounded-xl border border-line shadow-sm">
      <div className="px-5 py-3 border-b border-line-soft flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="font-semibold text-ink">{collection.label}</h2>
        <span className="text-sm text-ink-3">
          {state.rows.length} {state.rows.length === 1 ? 'entry' : 'entries'}
          {total !== null ? ` · $${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : ''}
        </span>
        {wide ? (
          <div className="ml-auto flex items-center gap-2">
            <div className="inline-flex overflow-hidden rounded-lg border border-line-strong" role="group" aria-label="View">
              {[['cards', LayoutGrid, 'Cards'], ['table', Table2, 'Table']].map(([k, Icon, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setView(k)}
                  aria-pressed={view === k}
                  title={`${label} view`}
                  className={`flex items-center gap-1 px-2.5 py-1 text-xs font-semibold ${
                    view === k ? 'bg-primary text-white' : 'bg-surface text-ink-3 hover:bg-hover'
                  }`}
                >
                  <Icon size={13} /> {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setOpenId('new')}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-2"
            >
              <Plus size={14} /> Add {noun}
            </button>
          </div>
        ) : null}
      </div>

      {wide && view === 'cards' ? (
        state.rows.length > 0 ? (
          <div className="space-y-2.5 p-4">
            {state.rows.map((row) => (
              <ItemCard
                key={row.id}
                collection={collection}
                layout={layout}
                row={row}
                matterId={matterId}
                docTemplates={docTemplates}
                onOpen={setOpenId}
              />
            ))}
          </div>
        ) : (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-ink-4">No entries yet.</p>
            <button
              type="button"
              onClick={() => setOpenId('new')}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-sm text-ink-2 hover:bg-hover"
            >
              <Plus size={14} /> Add the first {noun}
            </button>
          </div>
        )
      ) : state.rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              {/*
                Headers are text-ink-2 and bold, not text-ink-4 and semibold.
                At the faint end of the ink scale they disappeared into the rows
                and staff could not tell which column they were typing in. Every
                section table shares this renderer, so this is the one place it
                changes.
              */}
              <tr className="border-b border-line-soft bg-canvas">
                {cols.map((c) => (
                  <th key={c.key} className="text-left px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-ink-2 whitespace-nowrap">
                    {c.label}
                  </th>
                ))}
                {/*
                  ⚠️ PINNED TO THE RIGHT EDGE, AND WIDE ENOUGH FOR ITS BUTTONS.
                  This was a bare 40px column at the end of an eighteen-column
                  table that scrolls sideways -- so the row's actions sat off
                  the right of the screen and had to be hunted for. That was
                  survivable while the only action was Delete. It is not
                  survivable for Generate, which is a thing the records clerk
                  does many times a day: a button nobody can find is a feature
                  nobody has.
                */}
                <th className="sticky right-0 z-10 w-48 bg-canvas px-2 border-l border-line-soft" />
              </tr>
            </thead>
            <tbody>
              {state.rows.map((row) => (
                <tr key={row.id} className="border-b border-line-soft last:border-0">
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
                  <td className="sticky right-0 z-10 bg-surface px-2 align-middle border-l border-line-soft">
                    <div className="flex items-center justify-end gap-0.5">
                      {/*
                        Document templates for this table, if any. Driven by
                        the registry in lib/domain/docgen.js, so the firm's
                        other four Filevine templates arrive as configuration
                        rather than as another button wired in by hand.
                      */}
                      <DocButtons matterId={matterId} templates={docTemplates} row={row} />
                      <button
                        onClick={() => deleteSectionRow(matterId, storageKey, row.id)}
                        className="p-1.5 text-ink-4 hover:text-danger-ink"
                        title="Delete row"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-5 py-8 text-center text-sm text-ink-4">No entries yet.</p>
      )}

      {/*
        The always-open add form is for narrow tables only. On a wide one it
        was nineteen empty boxes flowing into whatever space was left -- the
        cluttered form the firm sent a screenshot of. Wide tables add through
        the drawer, with the same grouped two-column layout as editing.
      */}
      {!wide ? (
      <div className="px-5 py-3 border-t border-line-soft bg-canvas/60 flex flex-wrap items-end gap-3">
        {/*
          Every column, not the first three. It used to slice(0, 3), so on
          Insurance you could enter carrier, coverage and policy number but not
          limits, adjuster or claim number -- you had to add a blank row and
          fill the rest in the table.
        */}
        {cols
          /*
           * Only CALCULATED columns are skipped, because a computed total has
           * nothing to type into.
           *
           * Attachments used to be skipped too, on the grounds that they
           * "need a saved row to hang off". That was not true. DriveDrop
           * sends the file to the CASE's folder -- Medicals, Pleadings --
           * not to anywhere belonging to a row, and the row only ever stores
           * the { id, name, url } it gets back. A draft row holds that as
           * happily as a saved one.
           *
           * The inconsistency gave it away: `driveFile` uses the SAME
           * component and was always in this form, so Medical Records
           * Request could be attached while adding a provider and Medical
           * Records and Bills could not -- they had to be added first and
           * uploaded afterwards, on a row already in the table.
           *
           * ⚠️ The one real consequence, which driveFile already had: a file
           * uploaded and then abandoned without pressing Add is in Drive and
           * referenced by nothing. It is in the case's own folder, so it is
           * findable rather than lost -- and losing the file instead would be
           * the worse trade.
           */
          .filter((c) => c.type !== 'calculated')
          .map((c) => (
            <div
              key={c.key}
              className={c.type === 'textarea' ? 'flex-1' : ''}
              style={{ minWidth: columnMinWidth(c.type) }}
            >
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-4 mb-1">
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
          onClick={async () => {
            /*
             * Awaited, and the draft is cleared only if the row actually
             * saved. Clearing it first meant a failed insert took the
             * typing with it and left nothing to retry from.
             */
            const result = await addSectionRow(matterId, storageKey, draft);
            if (result?.ok) setDraft({});
          }}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-2"
        >
          <Plus size={15} /> Add
        </button>
      </div>
      ) : null}

      {openId === 'new' || openRow ? (
        <ItemEditor
          collection={collection}
          layout={layout}
          storageKey={storageKey}
          matterId={matterId}
          uploadFolder={uploadFolder}
          row={openId === 'new' ? null : openRow}
          noun={noun}
          docTemplates={docTemplates}
          onClose={() => setOpenId(null)}
        />
      ) : null}
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
    <div className="bg-surface rounded-xl border border-line shadow-sm">
      {title ? (
        <div className="px-5 py-3 border-b border-line-soft">
          <h2 className="font-semibold text-ink">{title}</h2>
        </div>
      ) : null}
      <div className="p-5 grid gap-4 sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f.key} className={f.type === 'textarea' || f.full ? 'sm:col-span-2' : ''}>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-4 mb-1">
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
      {section.description ? <p className="text-sm text-ink-3">{section.description}</p> : null}

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
        <p className="text-xs text-ink-4">
          Fields captured from the firm&apos;s own Filevine configuration.
        </p>
      ) : (
        <p className="text-xs text-warn-ink">
          These fields are a first pass, not yet confirmed against Filevine — capture a matter
          that has data in this section and they can be replaced with the real ones.
        </p>
      )}
    </div>
  );
}
