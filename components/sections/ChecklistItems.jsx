'use client';

/**
 * Yes/no-with-a-date-and-a-document items, for whichever section owns them.
 *
 * These thirteen used to live together in one "Litigation" tab. The firm's real
 * rail has no such tab, so each item now renders inside the section it belongs
 * to — Served under Pleading, the discovery items under Discovery, and so on.
 *
 * The component asks `lib/domain/fields.js` which items belong to a section
 * rather than being handed a key list. Relocating an item is therefore editing
 * one `section` string in that file, and nothing here changes.
 *
 * Marking an item done stamps today's date in the firm's timezone. That date is
 * the trigger five of the eight chain rules read, so an item marked done with
 * NO date produces no deadline at all — which is why the date input is always
 * visible and the missing-date case is called out in amber rather than left to
 * be noticed.
 */

import { CheckCircle2, Circle, ExternalLink, AlertTriangle } from 'lucide-react';
import { checklistFieldsForSection } from '@/lib/domain/fields';
import { todayInFirmTz } from '@/lib/domain/dates';
import { useData } from '@/lib/data/DataProvider';
import { CHAIN_RULE_BY_KEY } from '@/lib/domain/chain';

export default function ChecklistItems({ matterId, matter, sectionLabel, title = 'Checklist' }) {
  const { setChecklistItem } = useData();
  const values = matter?.values || {};
  const items = checklistFieldsForSection(sectionLabel);

  if (!items.length) return null;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm mb-4">
      <div className="px-5 py-3 border-b border-slate-100">
        <h2 className="font-semibold text-slate-900">{title}</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Items marked • generate a deadline. A date is required for the rule to fire.
        </p>
      </div>

      <div className="divide-y divide-slate-50">
        {items.map((f) => {
          const item = values[f.key] || { done: false, docUrl: '', note: '', date: '' };
          const drives = Boolean(CHAIN_RULE_BY_KEY[f.key]);
          const missingDate = item.done && !item.date && drives;

          return (
            <div key={f.key} className="px-5 py-3 flex items-start gap-4 flex-wrap">
              <button
                onClick={() =>
                  setChecklistItem(matterId, f.key, {
                    done: !item.done,
                    date: !item.done && !item.date ? todayInFirmTz() : item.date,
                  })
                }
                className="shrink-0 mt-1"
                title={item.done ? 'Mark not done' : 'Mark done'}
              >
                {item.done ? (
                  <CheckCircle2 size={22} className="text-teal-600" />
                ) : (
                  <Circle size={22} className="text-slate-300 hover:text-slate-400" />
                )}
              </button>

              <div className="flex-1 min-w-[160px]">
                <p className={`text-sm font-medium ${item.done ? 'text-slate-900' : 'text-slate-500'}`}>
                  {f.label}
                  {drives ? <span className="ml-1.5 text-amber-600" title="Drives a deadline">•</span> : null}
                </p>
                {item.note ? (
                  <p className="text-xs text-slate-500 mt-0.5 italic">imported note: &ldquo;{item.note}&rdquo;</p>
                ) : null}
                {missingDate ? (
                  <p className="flex items-center gap-1 text-xs text-amber-700 mt-1">
                    <AlertTriangle size={12} /> Marked done with no date — no deadline is being calculated
                  </p>
                ) : null}
              </div>

              <div className="w-[150px] shrink-0">
                <input
                  type="date"
                  className="input"
                  value={item.date || ''}
                  onChange={(e) => setChecklistItem(matterId, f.key, { date: e.target.value })}
                />
              </div>

              <div className="flex gap-1.5 w-[220px] shrink-0">
                <input
                  type="url"
                  className="input"
                  placeholder="Google Drive link"
                  value={item.docUrl || ''}
                  onChange={(e) => setChecklistItem(matterId, f.key, { docUrl: e.target.value })}
                />
                {item.docUrl ? (
                  <a
                    href={item.docUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 px-2.5 grid place-items-center border border-slate-200 rounded-lg text-teal-700 hover:bg-slate-50"
                    title="Open document"
                  >
                    <ExternalLink size={15} />
                  </a>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
