'use client';

/**
 * Documents — one search box across every case's Drive folder.
 *
 * This replaced a table of every indexed file. The index is gone: documents are
 * read live from Drive now, which makes this search strictly better rather than
 * worse. Drive's `fullText` matches text INSIDE PDFs and Docs, so a word that
 * appears only on page four of a scanned record is findable — something a table
 * of filenames could never do.
 *
 * Each hit says which case it belongs to, resolved by walking the file's Drive
 * parents up to a linked case folder. A file that belongs to no case is shown
 * as unfiled rather than attached to the nearest one.
 */

import { useState } from 'react';
import Link from 'next/link';
import { Search, ExternalLink, FileText, FolderSync, Loader2, AlertCircle } from 'lucide-react';
import RailLayout from '@/components/shell/RailLayout';
import { useData } from '@/lib/data/DataProvider';

export default function DocumentsPage() {
  const { backend } = useData();
  const [term, setTerm] = useState('');
  const [files, setFiles] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function search(e) {
    e?.preventDefault();
    const q = term.trim();
    if (q.length < 2) return;
    setBusy(true);
    setError('');
    try {
      const url = new URL('/api/drive/search', window.location.origin);
      url.searchParams.set('q', q);
      const res = await fetch(url);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error || 'Search failed.'); setFiles(null); }
      else setFiles(body.files || []);
    } catch (err) {
      setError(err?.message || 'Could not reach Drive.');
    } finally {
      setBusy(false);
    }
  }

  const rail = (
    <div className="px-5 space-y-4">
      <Link
        href="/documents/drive"
        className="flex items-center gap-2 text-sm font-semibold text-accent-ink hover:underline"
      >
        <FolderSync size={15} /> Google Drive sync
      </Link>
      <p className="text-xs text-ink-3 leading-snug">
        Searches Drive directly — including the text inside PDFs and Google Docs, not only
        filenames.
      </p>
      {/* `backend &&` because null means not-known-yet, and this warning must
          not appear before then. Rendering it on the strength of null was the
          hydration mismatch: the server said 'local', the browser said
          'supabase', and React discarded the whole server render of this page. */}
      {backend && backend !== 'supabase' ? (
        <p className="text-xs text-warn-ink leading-snug">
          Running on local storage, so there is no Drive to search.
        </p>
      ) : null}
    </div>
  );

  return (
    <RailLayout title="Documents" count={files?.length} rail={rail} wide>
      <form onSubmit={search} className="flex items-center gap-2 mb-5">
        <div className="flex items-center gap-2 flex-1 bg-surface border border-line-strong rounded-lg px-3 py-2">
          <Search size={16} className="text-ink-4 shrink-0" />
          <input
            autoFocus
            className="flex-1 outline-none text-sm"
            placeholder="Search every case — filenames and document contents"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </div>
        <button
          type="submit"
          disabled={busy || term.trim().length < 2}
          className="px-5 py-2 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-40 hover:bg-primary-2"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : 'Search'}
        </button>
      </form>

      {error ? (
        <p className="flex items-start gap-1.5 rounded border border-warn-line bg-warn-bg px-3 py-2 text-sm text-warn-ink-strong">
          <AlertCircle size={15} className="mt-0.5 shrink-0" /> {error}
        </p>
      ) : null}

      {/*
        Three distinct states. "Nothing searched yet" and "searched, no hits"
        look identical if you only check for an empty array, and telling a
        paralegal there are no matching documents when they have not searched
        is worse than saying nothing.
      */}
      {files === null && !error ? (
        <p className="py-16 text-center text-sm text-ink-4">
          Type at least two characters and press Search.
        </p>
      ) : null}

      {files !== null && files.length === 0 ? (
        <p className="py-16 text-center text-sm text-ink-4">
          Nothing in Drive matches “{term.trim()}”.
        </p>
      ) : null}

      {files?.length ? (
        <div className="bg-surface rounded-lg border border-line shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-canvas">
                {['Name', 'Case', 'Modified', ''].map((h) => (
                  <th key={h} className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.id} className="border-b border-line-soft last:border-0 hover:bg-hover">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText size={15} className="text-ink-4 shrink-0" />
                      <span className="font-medium text-ink truncate">{f.name}</span>
                      {f.sizeBytes ? (
                        <span className="text-xs text-ink-4 shrink-0">
                          {Math.max(1, Math.round(f.sizeBytes / 1024))} KB
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    {f.matterId ? (
                      <Link href={`/matters/${f.matterId}/docs`} className="text-accent-ink hover:underline">
                        {f.matterLabel}
                      </Link>
                    ) : (
                      <span className="text-ink-4" title="Not inside any linked case folder">
                        Unfiled
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-ink-3 whitespace-nowrap">
                    {f.modifiedTime ? f.modifiedTime.slice(0, 10) : '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    {f.webViewLink ? (
                      <a
                        href={f.webViewLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent-ink hover:text-accent-ink-strong"
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
        </div>
      ) : null}
    </RailLayout>
  );
}
