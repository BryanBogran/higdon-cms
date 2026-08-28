'use client';

/**
 * Docs — this case's Google Drive folder.
 *
 * Drive holds the files; this reads the index built by the sync. Nothing is
 * copied and nothing is moved, so what shows here is what is in the folder.
 *
 * Files open in Drive rather than streaming through this app. Drive's own
 * permissions still apply and Drive keeps its record of who opened what —
 * on medical records, an access log is worth more than a smoother preview.
 * See docs/DECISIONS.md.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, FileText, FolderSync, Search } from 'lucide-react';
import { useData } from '@/lib/data/DataProvider';

export default function DocsSection({ matterId, matter }) {
  const { documents, backend } = useData();
  const [q, setQ] = useState('');

  // Kept apart on purpose. "This case has no documents" and "your search
  // matched none of them" are different facts, and collapsing them lets a
  // filtered search render an empty-state about Drive configuration.
  const allFiles = useMemo(
    () =>
      Object.values(documents || {})
        .filter((d) => d.matterId === matterId)
        .sort((a, b) => String(b.modifiedTime).localeCompare(String(a.modifiedTime))),
    [documents, matterId]
  );

  const needle = q.trim().toLowerCase();
  const files = useMemo(
    () => (needle ? allFiles.filter((d) => d.name.toLowerCase().includes(needle)) : allFiles),
    [allFiles, needle]
  );

  const linked = Boolean(matter?.driveFolderId);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
      <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center gap-3">
        <h2 className="font-semibold text-slate-900">Docs</h2>
        <span className="text-sm text-slate-500">
          {needle ? `${files.length} of ${allFiles.length}` : `${allFiles.length} file${allFiles.length === 1 ? '' : 's'}`}
        </span>
        <div className="flex-1" />
        <div className="flex items-center gap-1.5 min-w-[180px]">
          <Search size={14} className="text-slate-400 shrink-0" />
          <input
            className="input"
            placeholder="Find a file"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      {/*
        FILES FIRST, unconditionally. This tab exists to show documents, so a
        link flag that is stale, missing, or simply not mapped out of the
        database must never hide files that are demonstrably indexed. That is
        exactly what went wrong: the header counted the files while the body
        said "no folder linked", because `driveFolderId` never reached the
        client.

        Only when there is nothing to show do the empty states matter, and
        they are said apart because an empty list looks identical whether
        Drive is unconnected, this case has no folder, or the folder is
        genuinely empty -- and only the last means "there are no documents".
      */}
      {/* A search that matched nothing answers before any other empty state. */}
      {allFiles.length > 0 && files.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-slate-400">
          No files match “{q.trim()}”.
        </p>
      ) : null}

      {allFiles.length > 0 ? null : backend !== 'supabase' ? (
        <p className="px-5 py-10 text-center text-sm text-slate-400">
          Drive indexing needs a server. Running on local storage.
        </p>
      ) : !linked ? (
        <div className="px-5 py-10 text-center">
          <p className="text-sm text-slate-500">This case has no Drive folder linked yet.</p>
          <Link
            href="/documents/drive"
            className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-teal-700 hover:underline"
          >
            <FolderSync size={14} /> Link it in Drive sync
          </Link>
        </div>
      ) : (
        <p className="px-5 py-10 text-center text-sm text-slate-400">
          Nothing indexed yet in “{matter.driveFolderName || 'the linked folder'}”. Run
          &ldquo;Index files&rdquo; in Drive sync.
        </p>
      )}

      {files.length > 0 ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              {['Name', 'Folder', 'Modified', ''].map((h) => (
                <th key={h} className="text-left px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <FileText size={15} className="text-slate-400 shrink-0" />
                    <span className="font-medium text-slate-900">{f.name}</span>
                    {/* Google Docs carry no byte size at all — absent, not zero. */}
                    {f.sizeBytes ? (
                      <span className="text-xs text-slate-400">
                        {Math.max(1, Math.round(f.sizeBytes / 1024))} KB
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-slate-500">{f.folderPath || '—'}</td>
                <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">
                  {f.modifiedTime ? f.modifiedTime.slice(0, 10) : '—'}
                </td>
                <td className="px-4 py-2.5">
                  {f.webViewLink ? (
                    <a
                      href={f.webViewLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-teal-700 hover:text-teal-900"
                      title="Open in Google Drive"
                    >
                      <ExternalLink size={16} />
                    </a>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
