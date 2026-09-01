'use client';

/**
 * Two ways to get an email onto a matter, side by side.
 *
 *   THE ADDRESS  — the matter's own inbox. CC or forward, and it files itself.
 *                  This is Filevine's mechanism, and the one that scales,
 *                  because it costs nothing per message once it is set up.
 *
 *   THE DROP     — a .eml dragged onto the feed. Works with no DNS at all, so
 *                  it works today, and it stays useful afterwards for the back
 *                  catalogue nobody thought to CC.
 *
 * The address is shown even before its MX record exists, greyed with a note.
 * Hiding it until the DNS is live would mean nobody discovers the feature on
 * the day it starts working.
 */

import { useCallback, useRef, useState } from 'react';
import { Mail, Copy, Check, Upload, Loader2, AlertCircle } from 'lucide-react';
import { useData } from '@/lib/data/DataProvider';
import { intakeAddress } from '@/lib/domain/mailbox';

const MAIL_LIVE = process.env.NEXT_PUBLIC_INTAKE_MAIL_LIVE === 'true';

/** Shared upload handling: several files, reported one at a time. */
function useEmailUpload(matterId) {
  const { addEmail, currentUser } = useData();
  const [busy, setBusy] = useState(0);
  const [errors, setErrors] = useState([]);
  const [done, setDone] = useState('');

  const upload = useCallback(
    async (fileList) => {
      const files = [...fileList];
      if (!files.length) return;
      setErrors([]);
      setDone('');
      setBusy(files.length);

      let filed = 0;
      let duplicates = 0;
      const failed = [];

      // Sequential, not Promise.all. A paralegal dropping thirty messages at
      // once would otherwise open thirty parallel uploads, and the first
      // timeout would take the rest with it.
      for (const file of files) {
        const res = await addEmail(file, {
          matterId,
          author: currentUser?.displayName || currentUser?.email || undefined,
        });
        if (!res.ok) failed.push(`${file.name}: ${res.error}`);
        else if (res.duplicate) duplicates++;
        else filed++;
        setBusy((n) => n - 1);
      }

      setErrors(failed);
      const parts = [];
      if (filed) parts.push(`${filed} filed`);
      // Surfaced rather than silent. "Nothing happened" after dropping a file
      // looks like a bug; "already on this matter" is the actual answer.
      if (duplicates) parts.push(`${duplicates} already on this matter`);
      setDone(parts.join(' · '));
    },
    [addEmail, currentUser, matterId]
  );

  return { upload, busy, errors, done };
}

/** Wraps the feed so a message can be dropped anywhere on it, not just a strip. */
export function EmailDropTarget({ matterId, children }) {
  const { upload, busy, errors, done } = useEmailUpload(matterId);
  const [over, setOver] = useState(false);
  const depth = useRef(0); // dragenter fires per child; a boolean flickers

  return (
    <div
      onDragEnter={(e) => {
        e.preventDefault();
        depth.current += 1;
        setOver(true);
      }}
      onDragLeave={() => {
        depth.current -= 1;
        if (depth.current <= 0) setOver(false);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        if (e.dataTransfer.files?.length) upload(e.dataTransfer.files);
      }}
      className={`relative rounded-lg ${over ? 'outline outline-2 outline-dashed outline-teal-500 outline-offset-4' : ''}`}
    >
      {over ? (
        <div className="absolute inset-0 z-20 grid place-items-center bg-accent-bg/80 rounded-lg pointer-events-none">
          <p className="flex items-center gap-2 text-accent-ink-strong font-semibold">
            <Upload size={18} /> Drop to file on this case
          </p>
        </div>
      ) : null}

      {busy > 0 ? (
        <p className="mb-3 flex items-center gap-2 text-sm text-ink-2">
          <Loader2 size={14} className="animate-spin" /> Filing {busy} message{busy === 1 ? '' : 's'}…
        </p>
      ) : null}

      {done ? <p className="mb-3 text-sm text-accent-ink">{done}</p> : null}

      {errors.map((err, i) => (
        <p key={i} className="mb-2 flex items-start gap-1.5 text-sm text-danger-ink">
          <AlertCircle size={14} className="mt-0.5 shrink-0" /> {err}
        </p>
      ))}

      {children}
    </div>
  );
}

export default function EmailIntake({ matterId }) {
  const { matters } = useData();
  const { upload, busy } = useEmailUpload(matterId);
  const address = intakeAddress(matters[matterId]);
  const [copied, setCopied] = useState(false);
  const input = useRef(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard is blocked outside a secure context. The address is on
      // screen and selectable, so this is a missing convenience, not a failure.
    }
  }

  return (
    <div className="mb-4 rounded-lg border border-line bg-canvas px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Mail size={15} className="text-ink-4 shrink-0" />

        {address ? (
          <>
            <code className={`text-sm ${MAIL_LIVE ? 'text-ink' : 'text-ink-3'}`}>
              {address}
            </code>
            <button
              onClick={copy}
              className="flex items-center gap-1 text-xs text-accent-ink font-semibold hover:underline"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
            </button>
          </>
        ) : (
          <span className="text-sm text-ink-3">
            This matter has no email address yet — run <code>supabase/003_email.sql</code>.
          </span>
        )}

        <div className="flex-1" />

        <button
          onClick={() => input.current?.click()}
          disabled={busy > 0}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-line-strong bg-surface text-sm text-ink-2 hover:bg-raised disabled:opacity-50"
        >
          {busy > 0 ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
          Add email file
        </button>
        <input
          ref={input}
          type="file"
          accept=".eml,message/rfc822"
          multiple
          hidden
          onChange={(e) => {
            upload(e.target.files);
            e.target.value = ''; // so the same file can be re-picked after a fix
          }}
        />
      </div>

      <p className="mt-1.5 ml-6 text-xs text-ink-3">
        {MAIL_LIVE
          ? 'CC or forward to this address and the message files itself here.'
          : 'Not receiving mail yet — the MX record is not set up. Until then, drag a .eml onto the feed or use the button.'}{' '}
        Gmail: ⋮ → Download message. Outlook web: ⋯ → Download.
      </p>
    </div>
  );
}
