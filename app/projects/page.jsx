'use client';

/**
 * Project Hub -- the case list.
 *
 * Mirrors the Filevine layout: sort by last activity, filter dropdowns, removable
 * filter chips with a Clear action, a live count, the Show archived toggle, and
 * pagination. Columns match too: Project Name, Type, Phase, Tags, Primary, Last
 * Activity.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, Plus, X, ChevronDown } from 'lucide-react';
import { useData } from '@/lib/data/DataProvider';
import { matterTitle, initials, avatarColor, daysSinceActivity } from '@/lib/domain/matter';
import { FIELD_BY_KEY } from '@/lib/domain/fields';

const PAGE_SIZE = 50;

export default function ProjectHubPage() {
  const { matters, loaded, createMatter } = useData();
  const router = useRouter();

  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [attorney, setAttorney] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [page, setPage] = useState(0);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);

  const attorneys = useMemo(
    () => [...new Set(Object.values(matters).map((m) => m.values?.attorney).filter(Boolean))].sort(),
    [matters]
  );

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return Object.entries(matters)
      .filter(([, m]) => (showArchived ? true : !m.archivedAt))
      .filter(([, m]) => (status ? (m.values?.status || '') === status : true))
      .filter(([, m]) => (attorney ? (m.values?.attorney || '') === attorney : true))
      .filter(([, m]) => {
        if (!term) return true;
        const v = m.values || {};
        return (
          (v.clientName || '').toLowerCase().includes(term) ||
          (v.caseNumber || '').toLowerCase().includes(term)
        );
      })
      .map(([id, m]) => ({ id, matter: m, stale: daysSinceActivity(m) }))
      .sort((a, b) => (a.stale ?? 1e9) - (b.stale ?? 1e9));
  }, [matters, q, status, attorney, showArchived]);

  const pageRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));

  const chips = [
    status ? { label: status, clear: () => setStatus('') } : null,
    attorney ? { label: attorney, clear: () => setAttorney('') } : null,
    q.trim() ? { label: `"${q.trim()}"`, clear: () => setQ('') } : null,
  ].filter(Boolean);

  // createMatter is async — it may allocate a case number server-side — so the
  // id has to be awaited before navigating. Destructuring it synchronously
  // yields undefined and lands on a "no matter with that id" page.
  async function addMatter() {
    const name = newName.trim();
    if (!name || adding === 'busy') return;
    setAdding('busy');
    const result = await createMatter({ clientName: name, status: 'Open' });
    setNewName('');
    setAdding(false);
    if (result?.ok && result.id) router.push(`/matters/${result.id}`);
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <h1 className="text-2xl font-bold text-slate-900">Project Hub</h1>
        <div className="flex-1" />
        <div className="flex items-center gap-2 bg-white border border-slate-300 rounded px-3 py-1.5 w-full sm:w-72">
          <Search size={16} className="text-slate-400" />
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(0); }}
            placeholder="Search Projects"
            className="text-sm outline-none w-full"
          />
          {q ? (
            <button onClick={() => setQ('')} className="text-slate-400 hover:text-slate-700">
              <X size={14} />
            </button>
          ) : null}
        </div>
        {adding ? (
          <div className="flex items-center gap-1.5">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addMatter();
                if (e.key === 'Escape') setAdding(false);
              }}
              placeholder="Client name"
              className="input w-44"
            />
            <button onClick={addMatter} className="px-3 py-2 rounded bg-teal-600 text-white text-sm font-semibold">
              Add
            </button>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700"
          >
            <Plus size={16} /> Project
          </button>
        )}
      </div>

      <div className="flex items-center gap-3 flex-wrap mb-3 text-sm">
        <Facet label="Status" value={status} onChange={(v) => { setStatus(v); setPage(0); }}
          options={FIELD_BY_KEY.status.options} />
        <Facet label="Primary" value={attorney} onChange={(v) => { setAttorney(v); setPage(0); }}
          options={attorneys} />
        <label className="flex items-center gap-2 text-slate-600 cursor-pointer">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
        <span className="font-semibold text-slate-900">{rows.length} Projects</span>
      </div>

      {chips.length > 0 ? (
        <div className="flex items-center gap-2 flex-wrap mb-3">
          {chips.map((c, i) => (
            <span key={i} className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-slate-300 bg-white text-sm">
              {c.label}
              <button onClick={c.clear} className="text-slate-400 hover:text-slate-800">
                <X size={13} />
              </button>
            </span>
          ))}
          <button
            onClick={() => { setStatus(''); setAttorney(''); setQ(''); }}
            className="text-sm text-teal-700 font-semibold hover:underline"
          >
            Clear filters
          </button>
        </div>
      ) : null}

      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                {['Project Name', 'Status', 'Attorney', 'SOL', 'Trial Date', 'Last Activity'].map((h) => (
                  <th key={h} className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!loaded ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">Loading…</td></tr>
              ) : pageRows.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                  {rows.length === 0 && Object.keys(matters).length === 0
                    ? 'No cases yet. Add one with the + Project button.'
                    : 'No cases match these filters.'}
                </td></tr>
              ) : (
                pageRows.map(({ id, matter, stale }) => {
                  const v = matter.values || {};
                  return (
                    <tr key={id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <span className={`w-8 h-8 rounded-full ${avatarColor(id)} grid place-items-center text-white text-[11px] font-bold shrink-0`}>
                            {initials(matter)}
                          </span>
                          <Link href={`/matters/${id}`} className="font-medium text-teal-700 hover:underline">
                            {matterTitle(matter)}
                          </Link>
                          {matter.archivedAt ? (
                            <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 text-[10px] font-semibold">
                              ARCHIVED
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-700 whitespace-nowrap">{v.status || '—'}</td>
                      <td className="px-4 py-2.5 text-slate-700 whitespace-nowrap">{v.attorney || '—'}</td>
                      <td className="px-4 py-2.5 text-slate-700 whitespace-nowrap">{v.sol || '—'}</td>
                      <td className="px-4 py-2.5 text-slate-700 whitespace-nowrap">{v.trialDate || '—'}</td>
                      <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">
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
          <div className="px-4 py-2.5 border-t border-slate-200 flex items-center justify-between text-sm">
            <span className="text-slate-500">
              {page * PAGE_SIZE + 1} to {Math.min((page + 1) * PAGE_SIZE, rows.length)} of {rows.length}
            </span>
            <div className="flex items-center gap-2">
              <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}
                className="px-2.5 py-1 rounded border border-slate-300 disabled:opacity-40">Prev</button>
              <span className="text-slate-600">Page {page + 1} of {pages}</span>
              <button disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}
                className="px-2.5 py-1 rounded border border-slate-300 disabled:opacity-40">Next</button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Facet({ label, value, onChange, options = [] }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none bg-white border border-slate-300 rounded pl-3 pr-8 py-1.5 text-sm text-slate-700"
      >
        <option value="">{label}</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
      <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
    </div>
  );
}
