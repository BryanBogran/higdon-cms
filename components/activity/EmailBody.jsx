'use client';

/**
 * The middle of an email card: subject, From, To, attachments, body.
 *
 * The chrome around it — avatar, timestamp, pin, kebab, "Assign as Task" — is
 * ActivityCard's, unchanged. An email is an activity entry that renders its
 * body differently, not a separate kind of object, which is why "Assign as
 * Task" works on one for free.
 *
 * Collapsed by default, like Filevine: a feed where every message is expanded
 * is unreadable once a thread runs past a few replies.
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight, Mail, Paperclip, Download, Loader2 } from 'lucide-react';
import { useData } from '@/lib/data/DataProvider';
import { addressLabel } from '@/lib/domain/email';

/** "Dana Whitfield records@higdonlawyers.com", or just the address. */
function Address({ addr }) {
  if (!addr) return <span className="text-ink-4">unknown</span>;
  return (
    <>
      {addr.name ? <span className="text-ink-2">{addr.name} </span> : null}
      <span className="text-accent-ink">{addr.email}</span>
    </>
  );
}

/**
 * Recipient lines truncate at two, like Filevine's trailing "…".
 * A HIPAA request CC'ing six providers otherwise pushes the body off screen.
 */
function AddressList({ addrs = [] }) {
  const [all, setAll] = useState(false);
  if (!addrs.length) return <span className="text-ink-4">—</span>;
  const shown = all ? addrs : addrs.slice(0, 2);
  return (
    <>
      {shown.map((a, i) => (
        <span key={`${a.email}-${i}`}>
          {i > 0 ? <span className="text-ink-4">, </span> : null}
          <Address addr={a} />
        </span>
      ))}
      {!all && addrs.length > 2 ? (
        <button onClick={() => setAll(true)} className="text-ink-4 hover:text-ink-2">
          … +{addrs.length - 2} more
        </button>
      ) : null}
    </>
  );
}

/**
 * One stored file.
 *
 * The href is minted on click and never stored. These point at medical records;
 * a URL in a database column is a credential that outlives its purpose.
 */
function AttachmentRow({ file }) {
  const { signFile } = useData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function open() {
    if (!file.path) return;
    setBusy(true);
    setError('');
    const res = await signFile(file.path);
    setBusy(false);
    if (!res.ok) {
      setError(res.error || 'Could not open that file.');
      return;
    }
    window.open(res.url, '_blank', 'noopener,noreferrer');
  }

  const isOriginal = file.role === 'original';

  return (
    <div>
      <button
        onClick={open}
        disabled={!file.path || busy}
        title={file.path ? 'Open — the link expires in five minutes' : 'Not stored in local mode'}
        className={`flex items-center gap-1.5 text-xs ${
          file.path ? 'text-accent-ink hover:underline' : 'text-ink-4 cursor-not-allowed'
        }`}
      >
        {busy ? (
          <Loader2 size={12} className="animate-spin" />
        ) : isOriginal ? (
          <Mail size={12} />
        ) : (
          <Paperclip size={12} />
        )}
        <span className="truncate max-w-[22rem]">{file.name}</span>
        {file.size ? (
          <span className="text-ink-4">({Math.max(1, Math.round(file.size / 1024))} KB)</span>
        ) : null}
        {file.path ? <Download size={11} className="text-ink-4" /> : null}
      </button>
      {error ? <p className="text-xs text-danger-ink mt-0.5">{error}</p> : null}
    </div>
  );
}

export default function EmailBody({ entry }) {
  const [open, setOpen] = useState(false);
  const meta = entry.meta || {};
  const files = entry.attachments || [];
  const subject = entry.subject || meta.subject || '(no subject)';

  return (
    <div className="min-w-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-start gap-1 text-left w-full group"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown size={15} className="mt-0.5 shrink-0 text-ink-4" />
        ) : (
          <ChevronRight size={15} className="mt-0.5 shrink-0 text-ink-4" />
        )}
        <span className="text-sm font-semibold text-ink group-hover:underline break-words">
          {subject}
        </span>
      </button>

      <dl className="mt-1 ml-5 text-sm space-y-0.5">
        <div className="flex gap-1.5">
          <dt className="text-ink-3 shrink-0">From:</dt>
          <dd className="min-w-0 break-words"><Address addr={meta.from} /></dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-ink-3 shrink-0">To:</dt>
          <dd className="min-w-0 break-words"><AddressList addrs={meta.to} /></dd>
        </div>
        {meta.cc?.length ? (
          <div className="flex gap-1.5">
            <dt className="text-ink-3 shrink-0">Cc:</dt>
            <dd className="min-w-0 break-words"><AddressList addrs={meta.cc} /></dd>
          </div>
        ) : null}
      </dl>

      {open ? (
        <div className="ml-5 mt-2.5 pl-3 border-l-2 border-line">
          {entry.body ? (
            <p className="text-sm text-ink whitespace-pre-wrap break-words">{entry.body}</p>
          ) : (
            <p className="text-sm text-ink-4 italic">
              This message had no text — open the original below.
            </p>
          )}
          {meta.hasHtml ? (
            <p className="mt-2 text-xs text-ink-4">
              Shown as plain text. The formatted version is in the original message.
            </p>
          ) : null}
        </div>
      ) : null}

      {files.length ? (
        <div className="mt-2 ml-5 space-y-1">
          {files.map((f, i) => (
            <AttachmentRow key={f.path || `${f.name}-${i}`} file={f} />
          ))}
        </div>
      ) : null}

      {/* Local mode keeps headers but not bytes. Say so, rather than showing a
          link that fails -- a dead link on a case file reads as a lost record. */}
      {meta.filesNotStored ? (
        <p className="mt-1.5 ml-5 text-xs text-warn-ink">
          Stored on this device only; attachment files were not kept. Re-file this message once
          the database is connected.
        </p>
      ) : null}
    </div>
  );
}
