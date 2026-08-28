'use client';

/**
 * "Search for a project" -- present in Filevine's bar on every page, so finding
 * a case never means navigating away first. Matches client name and case number.
 */

import { useMemo, useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { useData } from '@/lib/data/DataProvider';
import { matterTitle } from '@/lib/domain/matter';

export default function GlobalSearch() {
  const { matters } = useData();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    function onDocClick(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    return Object.entries(matters)
      .filter(([, m]) => !m.archivedAt)
      .filter(([, m]) => {
        const v = m.values || {};
        return (
          (v.clientName || '').toLowerCase().includes(term) ||
          (v.caseNumber || '').toLowerCase().includes(term)
        );
      })
      .slice(0, 8)
      .map(([id, m]) => ({ id, title: matterTitle(m), status: m.values?.status || '' }));
  }, [q, matters]);

  function go(id) {
    setQ('');
    setOpen(false);
    router.push(`/matters/${id}`);
  }

  return (
    <div ref={boxRef} className="relative w-full max-w-md">
      <div className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded px-3 py-1.5">
        <Search size={16} className="text-slate-400 shrink-0" />
        <input
          // The main menu's Search item focuses this by id. A ref would have to
          // be threaded through TopRail and the drawer for no extra safety.
          id="global-search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results[0]) go(results[0].id);
            if (e.key === 'Escape') setOpen(false);
          }}
          placeholder="Search for a project"
          className="bg-transparent text-sm text-white placeholder-slate-400 outline-none w-full"
        />
      </div>

      {open && q.trim() ? (
        <div className="absolute left-0 right-0 mt-1 bg-white rounded-lg shadow-xl border border-slate-200 overflow-hidden z-50">
          {results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-500">No matching cases.</p>
          ) : (
            results.map((r) => (
              <button
                key={r.id}
                onClick={() => go(r.id)}
                className="w-full text-left px-4 py-2.5 hover:bg-slate-50 border-b border-slate-100 last:border-0"
              >
                <span className="block text-sm font-medium text-teal-700 truncate">{r.title}</span>
                {r.status ? <span className="block text-xs text-slate-500">{r.status}</span> : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
