'use client';

/**
 * Project Hub -- the case list.
 *
 * Mirrors the Filevine layout: sort by last activity, filter dropdowns, removable
 * filter chips with a Clear action, a live count, the Show archived toggle, and
 * pagination. Columns match too: Project Name, Type, Phase, Tags, Primary, Last
 * Activity.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Search, Plus, X, ChevronDown, ArrowUpNarrowWide, ArrowDownWideNarrow,
} from 'lucide-react';
import { useData } from '@/lib/data/DataProvider';
import CreateProjectPanel from '@/components/projects/CreateProjectPanel';
import { matterTitle, initials, avatarColor } from '@/lib/domain/matter';
import {
  buildCaseList, SORTS, CASE_TYPES, DEPO_FILTERS, CHECKLIST_FILTERS, directionLabel,
} from '@/lib/domain/case-list';
import { FIELD_BY_KEY } from '@/lib/domain/fields';

const PAGE_SIZE = 50;

export default function ProjectHubPage() {
  const { matters, loaded } = useData();

  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [attorney, setAttorney] = useState('');
  const [caseType, setCaseType] = useState('');
  const [depo, setDepo] = useState('');
  const [checklist, setChecklist] = useState('');
  const [sort, setSort] = useState('activity');
  const [direction, setDirection] = useState('asc');
  const [showArchived, setShowArchived] = useState(false);
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);

  /*
   * /projects/new redirects here with ?new=1 so there is one create form
   * rather than two that drift.
   *
   * Read off `window.location` rather than with `useSearchParams`, which opts
   * the whole page out of prerendering unless it is wrapped in Suspense --
   * this page is static otherwise, and a Suspense boundary around the entire
   * case list to read one flag is the wrong trade.
   *
   * The parameter is stripped once used, or the panel reopens on Back.
   */
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('new') !== '1') return;
    setCreating(true);
    window.history.replaceState(null, '', '/projects');
  }, []);

  const attorneys = useMemo(
    () => [...new Set(Object.values(matters).map((m) => m.values?.attorney).filter(Boolean))].sort(),
    [matters]
  );

  /*
   * Filtering and sorting live in lib/domain/case-list.js, not here. They are
   * rules rather than rendering -- whether a blank insurance class counts as
   * Unknown, where a case with no number sorts, whether a deposition ticked
   * without a date counts as taken -- and none of those can be tested inside
   * a component.
   */
  const rows = useMemo(
    () => buildCaseList(matters, { q, status, attorney, caseType, depo, checklist, showArchived, sort, direction }),
    [matters, q, status, attorney, caseType, depo, checklist, showArchived, sort, direction]
  );

  const pageRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));

  const chips = [
    status ? { label: status, clear: () => setStatus('') } : null,
    attorney ? { label: attorney, clear: () => setAttorney('') } : null,
    caseType ? { label: caseType, clear: () => setCaseType('') } : null,
    depo ? {
      label: DEPO_FILTERS.find((d) => d.key === depo)?.label || depo,
      clear: () => setDepo(''),
    } : null,
    checklist ? {
      label: CHECKLIST_FILTERS.find((c) => c.key === checklist)?.label || checklist,
      clear: () => setChecklist(''),
    } : null,
    q.trim() ? { label: `"${q.trim()}"`, clear: () => setQ('') } : null,
  ].filter(Boolean);

  // Sort is not a chip. A chip means "something is being hidden from you", and
  // a sort hides nothing -- putting one there would make Clear filters look
  // like it had left something on.
  function clearAll() {
    setStatus(''); setAttorney(''); setCaseType(''); setDepo(''); setChecklist(''); setQ(''); setPage(0);
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <h1 className="text-2xl font-bold text-ink">Project Hub</h1>
        <div className="flex-1" />
        <div className="flex items-center gap-2 bg-surface border border-line-strong rounded px-3 py-1.5 w-full sm:w-72">
          <Search size={16} className="text-ink-4" />
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(0); }}
            placeholder="Search Projects"
            className="text-sm outline-none w-full"
          />
          {q ? (
            <button onClick={() => setQ('')} className="text-ink-4 hover:text-ink-2">
              <X size={14} />
            </button>
          ) : null}
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded bg-accent-solid text-white text-sm font-semibold hover:bg-accent-solid-2"
        >
          <Plus size={16} /> Project
        </button>
      </div>

      <div className="flex items-center gap-3 flex-wrap mb-3 text-sm">
        <Facet label="Status" value={status} onChange={(v) => { setStatus(v); setPage(0); }}
          options={FIELD_BY_KEY.status.options} />
        <Facet label="Primary" value={attorney} onChange={(v) => { setAttorney(v); setPage(0); }}
          options={attorneys} />
        <Facet label="Case type" value={caseType} onChange={(v) => { setCaseType(v); setPage(0); }}
          options={CASE_TYPES} />
        <Facet label="Depositions" value={depo} onChange={(v) => { setDepo(v); setPage(0); }}
          options={DEPO_FILTERS.map((d) => ({ value: d.key, label: d.label }))} />

        {/* Every checklist item, done or not. Grouped by section so the list
            reads the way the rail does. The Depositions facet above stays:
            it expresses "either" and "neither", which a per-item filter
            cannot, and it is the control the firm asked us to copy. */}
        <Facet label="Checklist" value={checklist} onChange={(v) => { setChecklist(v); setPage(0); }}
          options={CHECKLIST_FILTERS.map((c) => ({ value: c.key, label: c.label, group: c.section }))} />

        {/* Sort sits with the filters but is not one: it changes the order,
            never the contents, so it has no "any" option and no chip. */}
        <div className="flex items-center gap-1.5 text-ink-2">
          <span className="sr-only sm:not-sr-only">Sort</span>
          <select
            value={sort}
            onChange={(e) => { setSort(e.target.value); setPage(0); }}
            aria-label="Sort projects"
            className="border border-line-strong rounded px-2 py-1.5 bg-surface text-sm"
          >
            {SORTS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>

          {/*
            The direction, as its own button rather than six entries in the
            dropdown. Two controls that each do one thing beat one that does
            both, and reversing an order is the kind of thing you do
            repeatedly while reading a list -- one click, not open-scan-pick.

            Labelled in the terms of the CURRENT sort. "Descending" makes a
            reader work out what that means for case numbers; "Newest number
            first" does not.
          */}
          <button
            type="button"
            onClick={() => { setDirection((d) => (d === 'asc' ? 'desc' : 'asc')); setPage(0); }}
            aria-label={`Sorted ${directionLabel(sort, direction)} — click to reverse`}
            title={`${directionLabel(sort, direction)} — click to reverse`}
            className="flex items-center gap-1 rounded border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink-2 hover:border-ink-4 hover:text-ink"
          >
            {direction === 'asc'
              ? <ArrowUpNarrowWide size={14} className="text-ink-3" />
              : <ArrowDownWideNarrow size={14} className="text-ink-3" />}
            <span className="hidden lg:inline text-xs">{directionLabel(sort, direction)}</span>
          </button>
        </div>
        <label className="flex items-center gap-2 text-ink-2 cursor-pointer">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
        <span className="font-semibold text-ink">{rows.length} Projects</span>
      </div>

      {chips.length > 0 ? (
        <div className="flex items-center gap-2 flex-wrap mb-3">
          {chips.map((c, i) => (
            <span key={i} className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-line-strong bg-surface text-sm">
              {c.label}
              <button onClick={c.clear} className="text-ink-4 hover:text-ink">
                <X size={13} />
              </button>
            </span>
          ))}
          <button
            onClick={clearAll}
            className="text-sm text-accent-ink font-semibold hover:underline"
          >
            Clear filters
          </button>
        </div>
      ) : null}

      <div className="bg-surface rounded-lg border border-line shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-canvas">
                {['Project Name', 'Status', 'Attorney', 'SOL', 'Trial Date', 'Last Activity'].map((h) => (
                  <th key={h} className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!loaded ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-ink-4">Loading…</td></tr>
              ) : pageRows.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-ink-4">
                  {rows.length === 0 && Object.keys(matters).length === 0
                    ? 'No cases yet. Add one with the + Project button.'
                    : 'No cases match these filters.'}
                </td></tr>
              ) : (
                pageRows.map(({ id, matter, stale }) => {
                  const v = matter.values || {};
                  return (
                    <tr key={id} className="border-b border-line-soft last:border-0 hover:bg-hover">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <span className={`w-8 h-8 rounded-full ${avatarColor(id)} grid place-items-center text-white text-[11px] font-bold shrink-0`}>
                            {initials(matter)}
                          </span>
                          <Link href={`/matters/${id}`} className="font-medium text-accent-ink hover:underline">
                            {matterTitle(matter)}
                          </Link>
                          {matter.archivedAt ? (
                            <span className="px-1.5 py-0.5 rounded bg-raised-2 text-ink-2 text-[10px] font-semibold">
                              ARCHIVED
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-ink-2 whitespace-nowrap">{v.status || '—'}</td>
                      <td className="px-4 py-2.5 text-ink-2 whitespace-nowrap">{v.attorney || '—'}</td>
                      <td className="px-4 py-2.5 text-ink-2 whitespace-nowrap">{v.sol || '—'}</td>
                      <td className="px-4 py-2.5 text-ink-2 whitespace-nowrap">{v.trialDate || '—'}</td>
                      <td className="px-4 py-2.5 text-ink-3 whitespace-nowrap">
                        {stale === null ? '—' : stale === 0 ? 'Today' : `${stale}d ago`}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {pages > 1 ? (
          <div className="px-4 py-2.5 border-t border-line flex items-center justify-between text-sm">
            <span className="text-ink-3">
              {page * PAGE_SIZE + 1} to {Math.min((page + 1) * PAGE_SIZE, rows.length)} of {rows.length}
            </span>
            <div className="flex items-center gap-2">
              <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}
                className="px-2.5 py-1 rounded border border-line-strong disabled:opacity-40">Prev</button>
              <span className="text-ink-2">Page {page + 1} of {pages}</span>
              <button disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}
                className="px-2.5 py-1 rounded border border-line-strong disabled:opacity-40">Next</button>
            </div>
          </div>
        ) : null}
      </div>
      <CreateProjectPanel open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

/**
 * One filter dropdown. The empty option is the label, so an unset facet reads
 * as "Status" rather than "Status: any" and the row stays scannable.
 *
 * Options are plain strings where the value IS the label -- a status, an
 * attorney -- or `{ value, label }` where they differ, which the deposition
 * filter needs: it stores 'neither' and has to read "No depo taken yet".
 */
function Facet({ label, value, onChange, options = [] }) {
  const items = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));

  /*
   * Grouped when any option carries a `group`. The checklist facet has 26
   * options across five sections; ungrouped that is a wall, and the section is
   * how anyone finds the item they mean.
   */
  const groups = items.some((o) => o.group)
    ? items.reduce((acc, o) => {
      const g = o.group || '';
      (acc[g] = acc[g] || []).push(o);
      return acc;
    }, {})
    : null;

  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="appearance-none bg-surface border border-line-strong rounded pl-3 pr-8 py-1.5 text-sm text-ink-2"
      >
        <option value="">{label}</option>
        {groups
          ? Object.entries(groups).map(([g, opts]) => (
            <optgroup key={g} label={g}>
              {opts.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </optgroup>
          ))
          : items.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
      </select>
      <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-4 pointer-events-none" />
    </div>
  );
}
