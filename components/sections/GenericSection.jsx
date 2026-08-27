'use client';

/**
 * THE MULTIPLIER.
 *
 * Ten of the fourteen Filevine sections are the same three things in different
 * arrangements: a field group, a repeating row collection, and attachments. One
 * renderer driven by the registry means adding a section is configuration, not a
 * sprint -- which is what turns a ~450-hour build into a ~250-hour one.
 *
 * Sections start here and graduate to a purpose-built component only when real
 * use argues for it.
 */

import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import FieldInput from './FieldInput';
import { useData } from '@/lib/data/DataProvider';

function money(n) {
  const num = parseFloat(String(n ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(num) ? num : 0;
}

export default function GenericSection({ matterId, section }) {
  const { sectionState, setSectionField, addSectionRow, updateSectionRow, deleteSectionRow } = useData();
  const state = sectionState(matterId, section.key);
  const [draft, setDraft] = useState({});

  const cols = section.collection?.columns || [];
  const total = useMemo(() => {
    if (!section.collection?.total) return null;
    return state.rows.reduce((sum, r) => sum + money(r[section.collection.total]), 0);
  }, [state.rows, section.collection]);

  return (
    <div className="space-y-6">
      {section.description ? <p className="text-sm text-slate-500">{section.description}</p> : null}

      {section.fields ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="px-5 py-3 border-b border-slate-100">
            <h2 className="font-semibold text-slate-900">{section.label}</h2>
          </div>
          <div className="p-5 grid gap-4 sm:grid-cols-2">
            {section.fields.map((f) => (
              <div key={f.key} className={f.type === 'textarea' ? 'sm:col-span-2' : ''}>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
                  {f.label}
                </label>
                <FieldInput
                  field={f}
                  value={state.fields[f.key]}
                  onChange={(val) => setSectionField(matterId, section.key, f.key, val)}
                />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {section.collection ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">{section.collection.label}</h2>
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
                        <td key={c.key} className="px-3 py-2 align-top min-w-[130px]">
                          <FieldInput
                            field={c}
                            value={row[c.key]}
                            onChange={(val) => updateSectionRow(matterId, section.key, row.id, { [c.key]: val })}
                          />
                        </td>
                      ))}
                      <td className="px-2 align-middle">
                        <button
                          onClick={() => deleteSectionRow(matterId, section.key, row.id)}
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
            {cols.slice(0, 3).map((c) => (
              <div key={c.key} className="min-w-[140px]">
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
                  {c.label}
                </label>
                <FieldInput field={c} value={draft[c.key]} onChange={(val) => setDraft((d) => ({ ...d, [c.key]: val }))} />
              </div>
            ))}
            <button
              onClick={() => {
                addSectionRow(matterId, section.key, draft);
                setDraft({});
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800"
            >
              <Plus size={15} /> Add
            </button>
          </div>
        </div>
      ) : null}

      <p className="text-xs text-slate-400">
        This is a generic section. Its fields are a first pass — they will be replaced with the
        firm&apos;s real Filevine configuration once the template export is available.
      </p>
    </div>
  );
}
