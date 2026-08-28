'use client';

/**
 * Docs — a live browser over the case's Google Drive folder.
 *
 * This replaced a flat index. The old version walked the whole case, up to five
 * thousand files deep, flattened it into a table and rendered one long list
 * with the folder path demoted to a text column — which threw away the only
 * organisation the files had. A firm filing under Medical Records, Pleadings
 * and Correspondence got back an undifferentiated pile.
 *
 * Now: one folder at a time, straight from Drive. The structure staff already
 * built is the navigation, nothing is copied, and so nothing can be stale.
 *
 * Folders visited are cached for the life of the component, so going back up a
 * breadcrumb is instant. The cache is per-mount on purpose — leaving the matter
 * and returning re-reads Drive, which is the moment you would want fresh data.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Folder, FileText, ExternalLink, Search, ChevronRight, Loader2,
  FolderPlus, AlertCircle, X, Eye,
} from 'lucide-react';
import { useData } from '@/lib/data/DataProvider';

const PREVIEWABLE = /^(application\/pdf|image\/|application\/vnd\.google-apps\.(document|spreadsheet|presentation))/;

export default function DocsSection({ matterId, matter }) {
  const { backend } = useData();

  const [folderId, setFolderId] = useState(null);
  const [view, setView] = useState(null);        // { rootName, trail, children }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);

  const [term, setTerm] = useState('');
  const [results, setResults] = useState(null);  // null = not searching
  const [searching, setSearching] = useState(false);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const cache = useRef(new Map());

  const load = useCallback(
    async (target, { bustCache = false } = {}) => {
      const key = target || 'root';
      if (!bustCache && cache.current.has(key)) {
        setView(cache.current.get(key));
        setError('');
        return;
      }
      setLoading(true);
      setError('');
      try {
        const url = new URL('/api/drive/browse', window.location.origin);
        url.searchParams.set('matterId', matterId);
        if (target) url.searchParams.set('folderId', target);
        const res = await fetch(url);
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(body.error || `Could not read Drive (${res.status}).`);
          return;
        }
        cache.current.set(key, body);
        setView(body);
      } catch (err) {
        setError(err?.message || 'Could not reach Drive.');
      } finally {
        setLoading(false);
      }
    },
    [matterId]
  );

  useEffect(() => {
    if (backend !== 'supabase') return;
    cache.current.clear();
    setFolderId(null);
    setResults(null);
    setTerm('');
    load(null);
  }, [matterId, backend, load]);

  async function runSearch(e) {
    e?.preventDefault();
    const q = term.trim();
    if (q.length < 2) { setResults(null); return; }
    setSearching(true);
    setError('');
    try {
      const url = new URL('/api/drive/search', window.location.origin);
      url.searchParams.set('q', q);
      url.searchParams.set('matterId', matterId);
      const res = await fetch(url);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error || 'Search failed.');
      else setResults(body.files || []);
    } finally {
      setSearching(false);
    }
  }

  async function createFolder() {
    const name = newName.trim();
    if (!name) return;
    setError('');
    const res = await fetch('/api/drive/folder', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ matterId, parentId: folderId || view?.rootId, name }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) setError(body.error || 'Could not create the folder.');
    else {
      setNewName('');
      setCreating(false);
      await load(folderId, { bustCache: true });
    }
  }

  function open(target) {
    setFolderId(target);
    setResults(null);
    setTerm('');
    load(target);
  }

  /* ---------------- states that are not the browser ---------------- */

  if (backend !== 'supabase') {
    return (
      <Card>
        <p className="px-5 py-10 text-center text-sm text-slate-400">
          Browsing Drive needs a server. Running on local storage.
        </p>
      </Card>
    );
  }

  if (view && view.linked === false) {
    return (
      <Card>
        <div className="px-5 py-10 text-center">
          <p className="text-sm text-slate-500">This case has no Drive folder linked yet.</p>
          <Link
            href="/documents/drive"
            className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-teal-700 hover:underline"
          >
            Link it in Drive sync
          </Link>
        </div>
      </Card>
    );
  }

  const children = view?.children || [];
  const trail = view?.trail || [];

  return (
    <div className="space-y-4">
      <Card>
        {/* ---- breadcrumb + search ---- */}
        <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center gap-x-1 gap-y-2">
          <button
            onClick={() => open(null)}
            className={`text-sm ${trail.length ? 'text-teal-700 hover:underline' : 'font-semibold text-slate-900'}`}
          >
            {view?.rootName || matter?.driveFolderName || 'Case folder'}
          </button>
          {trail.map((c, i) => (
            <span key={c.id} className="flex items-center gap-1">
              <ChevronRight size={13} className="text-slate-300" />
              <button
                onClick={() => open(c.id)}
                className={`text-sm ${i === trail.length - 1 ? 'font-semibold text-slate-900' : 'text-teal-700 hover:underline'}`}
              >
                {c.name}
              </button>
            </span>
          ))}

          <div className="flex-1" />

          <form onSubmit={runSearch} className="flex items-center gap-1.5 min-w-[210px]">
            <Search size={14} className="text-slate-400 shrink-0" />
            <input
              className="input"
              placeholder="Search this case…"
              value={term}
              onChange={(e) => { setTerm(e.target.value); if (!e.target.value.trim()) setResults(null); }}
            />
          </form>

          <button
            onClick={() => setCreating((v) => !v)}
            title="Create a folder here"
            className="p-1.5 rounded text-slate-400 hover:text-slate-800 hover:bg-slate-100"
          >
            <FolderPlus size={16} />
          </button>
        </div>

        {creating ? (
          <div className="px-5 py-2.5 border-b border-slate-100 bg-slate-50/60 flex items-center gap-2">
            <input
              autoFocus
              className="input max-w-xs"
              placeholder="Folder name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') createFolder(); if (e.key === 'Escape') setCreating(false); }}
            />
            <button
              onClick={createFolder}
              disabled={!newName.trim()}
              className="px-3 py-1.5 rounded bg-slate-900 text-white text-sm font-semibold disabled:opacity-40"
            >
              Create
            </button>
            <button onClick={() => setCreating(false)} className="text-sm text-slate-500 hover:text-slate-800">
              Cancel
            </button>
          </div>
        ) : null}

        {error ? (
          <p className="px-5 py-2.5 flex items-start gap-1.5 text-sm text-amber-800 bg-amber-50 border-b border-amber-100">
            <AlertCircle size={15} className="mt-0.5 shrink-0" /> {error}
          </p>
        ) : null}

        {/* ---- listing ---- */}
        {loading || searching ? (
          <p className="px-5 py-10 text-center text-sm text-slate-400">
            <Loader2 size={15} className="inline animate-spin mr-1.5" />
            {searching ? 'Searching Drive…' : 'Reading Drive…'}
          </p>
        ) : results !== null ? (
          <Listing
            rows={results}
            emptyText={`Nothing in this case matches “${term.trim()}”.`}
            onPreview={setPreview}
            note="Drive searches inside PDFs and Docs, not just filenames."
          />
        ) : children.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-400">
            This folder is empty.
          </p>
        ) : (
          <Listing rows={children} onOpenFolder={open} onPreview={setPreview} />
        )}
      </Card>

      {preview ? <Preview file={preview} onClose={() => setPreview(null)} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Card({ children }) {
  return <div className="bg-white rounded-xl border border-slate-200 shadow-sm">{children}</div>;
}

function Listing({ rows, onOpenFolder, onPreview, emptyText, note }) {
  if (!rows.length) {
    return <p className="px-5 py-10 text-center text-sm text-slate-400">{emptyText || 'Nothing here.'}</p>;
  }
  return (
    <>
      {note ? <p className="px-5 pt-2.5 text-xs text-slate-400">{note}</p> : null}
      <ul className="divide-y divide-slate-50">
        {rows.map((r) => {
          const isFolder = r.isFolder ?? false;
          return (
            <li key={r.id} className="px-5 py-2.5 flex items-center gap-3 hover:bg-slate-50">
              {isFolder ? (
                <Folder size={16} className="text-sky-500 shrink-0" />
              ) : (
                <FileText size={16} className="text-slate-400 shrink-0" />
              )}

              {isFolder ? (
                <button
                  onClick={() => onOpenFolder?.(r.id)}
                  className="flex-1 min-w-0 text-left font-medium text-slate-900 hover:underline truncate"
                >
                  {r.name}
                </button>
              ) : (
                <span className="flex-1 min-w-0 truncate text-slate-800">{r.name}</span>
              )}

              {/* Google Docs carry no byte size at all -- absent, not zero. */}
              {r.sizeBytes ? (
                <span className="text-xs text-slate-400 shrink-0">
                  {Math.max(1, Math.round(r.sizeBytes / 1024))} KB
                </span>
              ) : null}
              {r.matterLabel ? (
                <span className="text-xs text-slate-500 shrink-0 truncate max-w-[14rem]">{r.matterLabel}</span>
              ) : null}
              <span className="text-xs text-slate-400 shrink-0 w-24 text-right">
                {r.modifiedTime ? r.modifiedTime.slice(0, 10) : ''}
              </span>

              {!isFolder && PREVIEWABLE.test(r.mimeType || '') ? (
                <button
                  onClick={() => onPreview(r)}
                  title="Preview"
                  className="p-1 text-slate-300 hover:text-slate-700 shrink-0"
                >
                  <Eye size={15} />
                </button>
              ) : null}
              {!isFolder && r.webViewLink ? (
                <a
                  href={r.webViewLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open in Google Drive"
                  className="p-1 text-slate-300 hover:text-teal-700 shrink-0"
                >
                  <ExternalLink size={15} />
                </a>
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}

/**
 * Drive's own embed. The viewer's Drive permissions still apply inside the
 * iframe — if they cannot open the file, Drive says so rather than this app
 * leaking it.
 */
function Preview({ file, onClose }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-2.5 border-b border-slate-100 flex items-center gap-3">
        <FileText size={15} className="text-slate-400 shrink-0" />
        <span className="font-medium text-slate-900 truncate">{file.name}</span>
        <div className="flex-1" />
        {file.webViewLink ? (
          <a
            href={file.webViewLink}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-teal-700 hover:underline"
          >
            Open in Drive
          </a>
        ) : null}
        <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-800" title="Close">
          <X size={16} />
        </button>
      </div>
      <iframe
        title={file.name}
        src={`https://drive.google.com/file/d/${file.id}/preview`}
        className="w-full h-[70vh] border-0"
        allow="autoplay"
      />
    </div>
  );
}
