'use client';

/**
 * Generate a document from one row — the Medical Records Request, today, and
 * the firm's four other Filevine templates as they arrive.
 *
 * ── ⚠️ IT REFUSES BEFORE IT PRODUCES SOMETHING HOLLOW ────────────────────
 *
 * The obvious behaviour is to fill what it can and leave the rest blank. That
 * is the wrong answer here and it is worth being explicit about why.
 *
 * A records request with an empty fax line is not a slightly worse letter. It
 * is a letter that reaches nobody, looks completely finished, and is filed in
 * the case as though it were sent. Nothing surfaces until somebody wonders,
 * weeks later, why a provider never answered — and by then the connection to
 * a blank field is long gone. A missing date of birth is worse still: a
 * records custodian matching on DOB rejects the request outright.
 *
 * So the server checks first and answers 422 with a list. This dialog shows
 * it in plain words with a link to the fix.
 *
 * ── And it can still be overridden ───────────────────────────────────────
 *
 * With a second, deliberate click. The clerk knows things the database does
 * not — they may be posting rather than faxing — and a tool that cannot be
 * overridden is simply worked around in Word, which loses the filing, the
 * link on the row and the consistency all at once. Better to be overridable
 * and know it happened.
 */

import { useState } from 'react';
import Link from 'next/link';
import { FileText, Loader2, AlertTriangle, X } from 'lucide-react';
import { useData } from '@/lib/data/DataProvider';

export default function GenerateDoc({ matterId, template, row, existing }) {
  const { updateSectionRow } = useData();
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(null);   // the 422 list
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);

  async function generate({ allowMissing = false } = {}) {
    setBusy(true);
    setError('');
    setBlocked(null);
    try {
      const res = await fetch('/api/docgen', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ matterId, templateKey: template.key, rowId: row.id, allowMissing }),
      });
      const body = await res.json().catch(() => ({}));

      if (res.status === 422) { setBlocked(body.missing || []); return; }
      if (!res.ok) { setError(body.error || 'The document could not be generated.'); return; }

      /*
       * The server has ALREADY written the link onto the row, on purpose: if
       * the browser were responsible and the tab closed in between, the letter
       * would sit in Drive with the case field empty and nobody would know it
       * existed.
       *
       * This writes the same value again so the cell updates now. It is
       * idempotent -- the identical ref -- and it does not wait on the
       * realtime round trip, which would be a poor thing to depend on for the
       * confirmation somebody just asked for.
       */
      if (body.file && body.field) {
        await updateSectionRow(matterId, template.storageKey, row.id, { [body.field]: body.file });
      }
    } catch {
      setError('The document could not be generated. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  function start() {
    // Replacing a letter that may already have been faxed, with no trace, is
    // worse than having two in the folder.
    if (existing && !confirming) { setConfirming(true); return; }
    setConfirming(false);
    generate();
  }

  const dialog = blocked || error || confirming ? (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4">
      <div className="w-full max-w-lg rounded-xl border border-line bg-surface shadow-lg">
        <div className="flex items-start justify-between gap-3 border-b border-line-soft px-5 py-3">
          <h2 className="flex items-center gap-2 font-semibold text-ink">
            {blocked ? <AlertTriangle size={16} className="text-warn-ink" /> : null}
            {blocked ? 'Some details are missing' : confirming ? 'Replace the existing letter?' : 'Could not generate'}
          </h2>
          <button
            type="button"
            onClick={() => { setBlocked(null); setError(''); setConfirming(false); }}
            className="p-1 text-ink-4 hover:text-ink-2"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 text-sm text-ink-2">
          {error ? <p>{error}</p> : null}

          {confirming ? (
            <p>
              This row already has <span className="font-medium text-ink">{existing.name}</span>.
              Generating again adds a second document — the existing one is not
              deleted, in case it has already been sent.
            </p>
          ) : null}

          {blocked ? (
            <>
              <p className="mb-3">
                {template.label} needs these before it can be sent. A letter with
                them blank is usually refused by the provider.
              </p>
              <ul className="space-y-2">
                {blocked.map((m) => (
                  <li key={m.token} className="rounded-lg border border-line bg-canvas px-3 py-2">
                    <p className="font-medium text-ink">{m.label}</p>
                    <p className="text-xs text-ink-3">{m.why}</p>
                    {m.reason === 'no-client-contact' ? (
                      <Link href={`/matters/${matterId}/case-info`} className="text-xs text-accent-ink hover:underline">
                        Link the client contact on Case Info →
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line-soft px-5 py-3">
          <button
            type="button"
            onClick={() => { setBlocked(null); setError(''); setConfirming(false); }}
            className="rounded-lg border border-line-strong px-3 py-1.5 text-sm text-ink-2 hover:bg-hover"
          >
            {blocked ? 'Fix it first' : 'Cancel'}
          </button>

          {confirming ? (
            <button
              type="button"
              onClick={() => { setConfirming(false); generate(); }}
              className="rounded-lg bg-accent-solid px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-solid-2"
            >
              Generate another
            </button>
          ) : null}

          {blocked ? (
            <button
              type="button"
              onClick={() => generate({ allowMissing: true })}
              className="rounded-lg border border-warn-line bg-warn-bg px-3 py-1.5 text-sm font-medium text-warn-ink-strong"
            >
              Generate anyway — {blocked.length} blank
            </button>
          ) : null}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      {/*
        Labelled, not a bare icon. The first version was a document glyph
        beside the delete glyph at the far right of a table that scrolls
        sideways, and the answer to "where is the button" was that there
        wasn't one anybody could find. Two icons that mean unrelated things,
        sitting together, are a puzzle rather than a control.
      */}
      <button
        type="button"
        onClick={start}
        disabled={busy}
        title={`Generate the ${template.label} for this row`}
        className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-line-strong px-2 py-1 text-[11px] font-semibold text-ink-2 transition hover:border-accent-solid hover:text-accent-ink disabled:opacity-50"
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
        {template.button || 'Generate'}
      </button>
      {dialog}
    </>
  );
}
