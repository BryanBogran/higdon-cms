'use client';

/**
 * Documents -- a firm-wide index across every matter's sections.
 *
 * The real Filevine Documents tab has a faceted filter rail (Title Contains, Doc
 * Contains, File Type, Doc Tags, Projects), a folder breadcrumb per row, and
 * full-text search inside file contents. Content search over Drive-hosted files
 * is a scoped decision rather than an assumed feature -- see the roadmap.
 *
 * Today this indexes every Drive link the app knows about: checklist documents
 * and any generic section row with a `docUrl`.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, ExternalLink, FileText } from 'lucide-react';
import RailLayout from '@/components/shell/RailLayout';
import { useData } from '@/lib/data/DataProvider';
import { matterTitle } from '@/lib/domain/matter';
import { FIELDS, DOC_FIELDS } from '@/lib/domain/fields';
import { SECTION_BY_KEY } from '@/lib/sections/registry';
import { fmt } from '@/lib/domain/dates';

const LABEL_BY_KEY = Object.fromEntries(FIELDS.map((f) => [f.key, f.label]));

export default function DocumentsPage() {
  const { matters, sections, loaded } = useData();
  const [title, setTitle] = useState('');
  const [project, setProject] = useState('');

  const docs = useMemo(() => {
    const out = [];

    for (const [matterId, matter] of Object.entries(matters)) {
      // Checklist documents
      for (const key of DOC_FIELDS) {
        const item = matter.values?.[key];
        if (item?.docUrl) {
          out.push({
            id: `${matterId}:${key}`,
            title: LABEL_BY_KEY[key] || key,
            url: item.docUrl,
            date: item.date || '',
            matterId,
            folder: 'Litigation',
          });
        }
      }
      // Generic section rows carrying a docUrl
      const forMatter = sections?.[matterId] || {};
      for (const [sectionKey, state] of Object.entries(forMatter)) {
        for (const row of state.rows || []) {
          if (row.docUrl) {
            out.push({
              id: `${matterId}:${sectionKey}:${row.id}`,
              title: row.title || row.description || row.provider || row.lienholder || 'Document',
              url: row.docUrl,
              date: row.date || '',
              matterId,
              folder: SECTION_BY_KEY[sectionKey]?.label || sectionKey,
            });
          }
        }
      }
    }
    return out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }, [matters, sections]);

  const projects = useMemo(
    () => Object.entries(matters).map(([id, m]) => ({ id, title: matterTitle(m) })),
    [matters]
  );

  const filtered = docs
    .filter((d) => (title.trim() ? d.title.toLowerCase().includes(title.trim().toLowerCase()) : true))
    .filter((d) => (project ? d.matterId === project : true));

  const rail = (
    <div className="px-5 space-y-5">
      <Facet label="Title Contains">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Find in document title" className="input" />
      </Facet>
      <Facet label="Doc Contains">
        <input disabled placeholder="Full-text search — not built yet" className="input opacity-50 cursor-not-allowed" />
      </Facet>
      <Facet label="Projects">
        <select value={project} onChange={(e) => setProject(e.target.value)} className="input">
          <option value="">All projects</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>
      </Facet>
      {title || project ? (
        <button onClick={() => { setTitle(''); setProject(''); }} className="text-sm text-teal-700 font-semibold hover:underline">
          Clear filters
        </button>
      ) : null}
    </div>
  );

  return (
    <RailLayout title="Documents" count={filtered.length} rail={rail} wide>
      {!loaded ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm text-slate-400">
            {docs.length === 0
              ? 'No documents yet. Paste a Google Drive link on a checklist item or a section row.'
              : 'No documents match these filters.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                {['Title', 'Date', 'Project', ''].map((h) => (
                  <th key={h} className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <tr key={d.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <FileText size={16} className="text-red-500 shrink-0" />
                      <span className="font-medium text-slate-900">{d.title}</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5 ml-6">
                      Higdon Lawyers / {matterTitle(matters[d.matterId])} / {d.folder}
                    </p>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{fmt(d.date)}</td>
                  <td className="px-4 py-2.5">
                    <Link href={`/matters/${d.matterId}`} className="text-teal-700 hover:underline">
                      {matterTitle(matters[d.matterId])}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-teal-700 hover:text-teal-900" title="Open in Google Drive">
                      <ExternalLink size={16} />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </RailLayout>
  );
}

function Facet({ label, children }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}
