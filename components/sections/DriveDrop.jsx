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
 */

import { useRef, useState } from 'react';
import { Paperclip, Upload, X, ExternalLink, Loader2, AlertCircle } from 'lucide-react';

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
          <Paperclip size={11} className="text-slate-400 shrink-0" />
          <a
            href={f?.url || '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-teal-700 hover:underline truncate flex-1 min-w-0"
          >
            {f?.name || 'Document'}
          </a>
          <ExternalLink size={10} className="text-slate-300 shrink-0" />
          <button
            onClick={() => remove(i)}
            title="Unlink from this field — the file stays in Drive"
            className="p-0.5 text-slate-300 hover:text-red-600 shrink-0"
          >
            <X size={12} />
          </button>
        </div>
      ))}

      {busy ? (
        <div className="text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <Loader2 size={11} className="animate-spin" />
            <span className="truncate">{busy.name}</span>
            <span className="shrink-0">{busy.percent}%</span>
          </span>
          <div className="mt-1 h-1 rounded bg-slate-100 overflow-hidden">
            <div className="h-full bg-teal-500 transition-all" style={{ width: `${busy.percent}%` }} />
          </div>
        </div>
      ) : (!multiple && list.length) ? null : (
        <button
          type="button"
          onClick={() => picker.current?.click()}
          className={`w-full flex items-center justify-center gap-1.5 rounded-lg border border-dashed px-2 py-1.5 text-xs transition ${
            over
              ? 'border-teal-500 bg-teal-50 text-teal-800'
              : 'border-slate-300 text-slate-400 hover:border-slate-400 hover:text-slate-600'
          }`}
        >
          <Upload size={12} />
          {over ? `Drop into ${folderName || 'this case'}` : placeholder}
        </button>
      )}

      <input
        ref={picker}
        type="file"
        multiple={multiple}
        hidden
        onChange={(e) => { upload(e.target.files); e.target.value = ''; }}
      />

      {error ? (
        <p className="mt-1 flex items-start gap-1 text-xs text-red-700">
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
