'use client';

/**
 * Drop a file here and it goes to Drive, in the right folder, linked to this
 * field.
 *
 * Replaces asking people to paste a URL. Pasting a Drive link means: open
 * Drive, find the case, find the subfolder, upload, wait, copy link, come back,
 * paste. Seven steps to record one document, and every one of them a chance to
 * paste the wrong link or drop the file in the wrong case.
 *
 * The field says which folder it belongs in — Medicals writes to *Medical
 * Records*, Pleading to *Pleadings* — and the server resolves that name against
 * this case, creating it if the case predates our folder template. A NAME is
 * sent, never an id: a name cannot be used to reach outside the case, and an id
 * could.
 *
 * Bytes go from the browser straight to Google via a resumable session. See
 * `createUploadSession` — a serverless request body is capped at a few
 * megabytes and a scanned record clears that easily.
 *
 * ── Linking a file that is already there ─────────────────────────────────
 *
 * Uploading is not always the right verb. A records request, an affidavit, a
 * deposition transcript — one document is often the answer to several fields,
 * and the firm was uploading it again for each one. That leaves duplicates in
 * Drive, and the duplicates drift: someone annotates one copy and the other
 * five still say what they said in March.
 *
 * So a file already in the case's Drive folder can be TAGGED instead. It
 * stores the same { id, name, url } reference an upload does, so nothing
 * downstream can tell the difference — the only change is that no second copy
 * of the file exists.
 */

import { useRef, useState } from 'react';
import {
  Paperclip, Upload, X, ExternalLink, Loader2, AlertCircle, Link2, Search,
} from 'lucide-react';

/** One stored reference: what Drive gave back, and enough to render a link. */
const toRef = (file) => ({
  id: file.id,
  name: file.name,
  url: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
});

export default function DriveDrop({
  value,
  onChange,
  matterId,
  folderName,
  multiple = false,
  placeholder = 'Drop a file, or click to choose',
}) {
  const list = multiple ? (Array.isArray(value) ? value : []) : value ? [value] : [];

  const [busy, setBusy] = useState(null);      // { name, percent }
  const [error, setError] = useState('');
  const [over, setOver] = useState(false);
  const picker = useRef(null);
  const depth = useRef(0);

  // Linking an existing file. `results` is null until a search has run, so
  // "nothing found" can be told apart from "nothing searched for yet".
  const [linking, setLinking] = useState(false);
  const [term, setTerm] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [scopeWarning, setScopeWarning] = useState(false);

  async function runSearch(e) {
    e?.preventDefault();
    const q = term.trim();
    // The API refuses a term under two characters: a blank search would return
    // the newest files in the whole Drive, which looks like a result and isn't.
    if (q.length < 2) { setResults(null); return; }
    setSearching(true);
    setError('');
    try {
      const url = new URL('/api/drive/search', window.location.origin);
      url.searchParams.set('q', q);
      url.searchParams.set('matterId', matterId);
      const res = await fetch(url);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error || `Search failed (${res.status}).`); return; }
      setResults(body.files || []);
      /*
       * ⚠️ SAID OUT LOUD. Past a folder cap the server drops the case scope,
       * so results can include files from OTHER CASES. On a legal file that is
       * not a footnote -- tagging another client's document onto this matter
       * is exactly the kind of mistake that is hard to notice and worse to
       * explain. The warning goes above the results, not below.
       */
      setScopeWarning(Boolean(body.scopeDropped));
    } catch (err) {
      setError(err?.message || 'Could not reach Drive.');
    } finally {
      setSearching(false);
    }
  }

  /** Tag an existing file. Same stored shape as an upload; no second copy. */
  function linkExisting(file) {
    const ref = {
      id: file.id,
      name: file.name,
      url: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
    };
    if (multiple) {
      const already = (Array.isArray(value) ? value : []).some((f) => f?.id === ref.id);
      if (already) { setError('That file is already linked here.'); return; }
      onChange([...(Array.isArray(value) ? value : []), ref]);
    } else {
      onChange(ref);
    }
    setLinking(false);
    setTerm('');
    setResults(null);
    setScopeWarning(false);
  }

  async function upload(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    if (!matterId) { setError('No case context for this upload.'); return; }

    setError('');
    const stored = [];

    for (const file of files) {
      setBusy({ name: file.name, percent: 0 });
      try {
        const res = await fetch('/api/drive/upload-url', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            matterId,
            folderName,
            name: file.name,
            mimeType: file.type || 'application/octet-stream',
            sizeBytes: file.size,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) { setError(body.error || `Upload refused (${res.status}).`); break; }

        const uploaded = await put(body.sessionUrl, file, (p) => setBusy({ name: file.name, percent: p }));
        stored.push(toRef(uploaded));
      } catch (err) {
        setError(err?.message || 'Upload failed.');
        break;
      }
    }

    setBusy(null);
    if (!stored.length) return;
    onChange(multiple ? [...list, ...stored] : stored[0]);
  }

  function remove(index) {
    // Unlinks from the field. The file stays in Drive on purpose -- deleting a
    // medical record because someone attached it to the wrong row is not a
    // recoverable mistake.
    if (multiple) onChange(list.filter((_, i) => i !== index));
    else onChange(null);
  }

  return (
    <div
      onDragEnter={(e) => { e.preventDefault(); depth.current += 1; setOver(true); }}
      onDragLeave={() => { depth.current -= 1; if (depth.current <= 0) setOver(false); }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        if (e.dataTransfer.files?.length) upload(e.dataTransfer.files);
      }}
    >
      {list.map((f, i) => (
        <div key={f?.id || i} className="flex items-center gap-1.5 mb-1">
          <Paperclip size={11} className="text-ink-4 shrink-0" />
          <a
            href={f?.url || '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-accent-ink hover:underline truncate flex-1 min-w-0"
          >
            {f?.name || 'Document'}
          </a>
          <ExternalLink size={10} className="text-ink-4 shrink-0" />
          <button
            onClick={() => remove(i)}
            title="Unlink from this field — the file stays in Drive"
            className="p-0.5 text-ink-4 hover:text-danger-ink shrink-0"
          >
            <X size={12} />
          </button>
        </div>
      ))}

      {busy ? (
        <div className="text-xs text-ink-3">
          <span className="flex items-center gap-1.5">
            <Loader2 size={11} className="animate-spin" />
            <span className="truncate">{busy.name}</span>
            <span className="shrink-0">{busy.percent}%</span>
          </span>
          <div className="mt-1 h-1 rounded bg-raised overflow-hidden">
            <div className="h-full bg-accent-solid-2 transition-all" style={{ width: `${busy.percent}%` }} />
          </div>
        </div>
      ) : (!multiple && list.length) ? null : (
        <div className="flex items-stretch gap-1.5">
          <button
            type="button"
            onClick={() => picker.current?.click()}
            className={`flex-1 min-w-0 flex items-center justify-center gap-1.5 rounded-lg border border-dashed px-2 py-1.5 text-xs transition ${
              over
                ? 'border-accent-solid bg-accent-bg text-accent-ink-strong'
                : 'border-line-strong text-ink-4 hover:border-ink-4 hover:text-ink-2'
            }`}
          >
            <Upload size={12} />
            <span className="truncate">
              {over ? `Drop into ${folderName || 'this case'}` : placeholder}
            </span>
          </button>
          {/*
            Not hidden behind a menu. Tagging an existing file is the RIGHT
            action often enough -- a records request answers several fields --
            that burying it would leave people uploading a second copy because
            that is the button they can see.
          */}
          <button
            type="button"
            onClick={() => { setLinking((o) => !o); setError(''); }}
            title="Link a file already in this case's Drive folder — no second copy"
            className={`shrink-0 flex items-center gap-1 rounded-lg border px-2 py-1.5 text-xs transition ${
              linking
                ? 'border-accent-solid bg-accent-bg text-accent-ink-strong'
                : 'border-line-strong text-ink-4 hover:border-ink-4 hover:text-ink-2'
            }`}
          >
            <Link2 size={12} />
            Existing
          </button>
        </div>
      )}

      {linking ? (
        <div className="mt-1.5 rounded-lg border border-line bg-surface p-2">
          <form onSubmit={runSearch} className="flex items-center gap-1.5">
            <Search size={12} className="text-ink-4 shrink-0" />
            <input
              autoFocus
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Search this case's Drive…"
              className="flex-1 min-w-0 bg-transparent text-xs text-ink outline-none placeholder:text-ink-4"
            />
            {searching ? <Loader2 size={12} className="animate-spin text-ink-4 shrink-0" /> : null}
          </form>

          {scopeWarning ? (
            <p className="mt-1.5 flex items-start gap-1 rounded bg-warn-bg px-1.5 py-1 text-[11px] text-warn-ink-strong">
              <AlertCircle size={11} className="mt-0.5 shrink-0" />
              This case has too many folders to search inside reliably — these
              results may include files from other cases. Check the name.
            </p>
          ) : null}

          {results === null ? (
            <p className="mt-1.5 text-[11px] text-ink-4">
              Type at least two characters, then press Enter.
            </p>
          ) : results.length === 0 ? (
            <p className="mt-1.5 text-[11px] text-ink-4">
              Nothing in this case's Drive folder matches “{term.trim()}”.
            </p>
          ) : (
            <ul className="mt-1.5 max-h-44 overflow-y-auto">
              {results.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => linkExisting(f)}
                    className="w-full flex items-center gap-1.5 rounded px-1 py-1 text-left text-xs text-ink-2 hover:bg-raised"
                  >
                    <Paperclip size={11} className="shrink-0 text-ink-4" />
                    <span className="truncate flex-1 min-w-0">{f.name}</span>
                    {f.modifiedTime ? (
                      <span className="shrink-0 text-[10px] text-ink-4">
                        {f.modifiedTime.slice(0, 10)}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <input
        ref={picker}
        type="file"
        multiple={multiple}
        hidden
        onChange={(e) => { upload(e.target.files); e.target.value = ''; }}
      />

      {error ? (
        <p className="mt-1 flex items-start gap-1 text-xs text-danger-ink">
          <AlertCircle size={11} className="mt-0.5 shrink-0" /> {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * PUT to the resumable session, reporting progress.
 *
 * XMLHttpRequest rather than fetch, because fetch has no upload progress event
 * — and on a large record a bar that never moves reads as a hang.
 */
function put(sessionUrl, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', sessionUrl, true);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`Drive rejected the upload (${xhr.status}).`));
        return;
      }
      try { resolve(JSON.parse(xhr.responseText)); }
      catch { reject(new Error('Drive accepted the file but returned nothing usable.')); }
    };
    /*
     * Reached only when the browser got no usable response at all. Drive's own
     * errors arrive as a status in onload.
     *
     * This used to fire on every upload: the session was created without the
     * browser's Origin, so Google answered 200 and the browser threw the
     * response away for want of an Access-Control-Allow-Origin header. The
     * file was in Drive and the field said the upload failed. Fixed where the
     * session is created -- see app/api/drive/upload-url/route.js.
     *
     * The warning about a possible duplicate stays, because that is what this
     * class of failure does: the bytes may well have arrived.
     */
    xhr.onerror = () =>
      reject(new Error(
        'The upload did not complete. Check the case folder in Drive before '
        + 'trying again — the file may have arrived even though this failed.'
      ));
    xhr.ontimeout = () => reject(new Error('The upload timed out before Google responded.'));
    xhr.onabort = () => reject(new Error('The upload was cancelled.'));
    xhr.send(file);
  });
}
