'use client';

/**
 * "Report a problem" — the button and its form.
 *
 * ── It has to work when the app does not ──────────────────────────────────
 *
 * This is the control people reach for precisely when something is broken, so
 * it takes as few dependencies as it can. It posts to a plain route rather
 * than going through DataProvider, it does not read matters or contacts, and
 * it lives in the top bar, which survives a section component crashing.
 *
 * ── It says what actually happened ────────────────────────────────────────
 *
 * The route stores the report first and emails second, and reports those
 * separately. If the email fails the report is still safe, and this says so
 * rather than showing a tick — a green tick over a notification nobody
 * received is how a bug goes unfixed for a month while somebody waits.
 *
 * ── Context is captured, not asked for ────────────────────────────────────
 *
 * The page, the browser, the window size and any errors already thrown are
 * attached automatically. Asking a paralegal for their user agent is asking
 * them to do the diagnosis.
 */

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  MessageSquareWarning, X, Loader2, CheckCircle2, AlertTriangle, Send,
} from 'lucide-react';
import { SEVERITIES, LIMITS } from '@/lib/domain/report';
import { installErrorCapture, recentErrors } from '@/lib/client-errors';

export default function ReportProblem() {
  const pathname = usePathname() || '';
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState('');
  const [detail, setDetail] = useState('');
  const [severity, setSeverity] = useState('normal');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const firstFieldRef = useRef(null);

  useEffect(() => { installErrorCapture(); }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => firstFieldRef.current?.focus(), 50);
  }, [open]);

  function reset() {
    setSummary(''); setDetail(''); setSeverity('normal');
    setResult(null); setError('');
  }

  async function submit(e) {
    e.preventDefault();
    if (!summary.trim() || busy) return;
    setBusy(true);
    setError('');

    try {
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          summary,
          detail,
          severity,
          // The page they were on, captured rather than asked for.
          page: typeof window !== 'undefined' ? window.location.pathname + window.location.search : pathname,
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
          viewport: typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : '',
          consoleErrors: recentErrors(),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error || `Could not send that (${res.status}).`); return; }
      setResult(body);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { reset(); setOpen(true); }}
        title="Report a problem with this system"
        aria-label="Report a problem"
        className="p-2 rounded text-chrome-muted hover:bg-white/10 hover:text-white"
      >
        <MessageSquareWarning size={18} />
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 grid place-items-start justify-center bg-slate-900/40 p-4 overflow-y-auto"
          onMouseDown={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Report a problem"
            onMouseDown={(e) => e.stopPropagation()}
            className="mt-16 w-full max-w-lg rounded-xl bg-surface text-ink shadow-2xl"
          >
            <div className="flex items-start justify-between border-b border-line-soft px-5 py-3">
              <h2 className="font-semibold">Report a problem</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close"
                className="p-1 text-ink-4 hover:text-ink-2">
                <X size={18} />
              </button>
            </div>

            {result ? (
              <div className="p-5">
                {result.emailed ? (
                  <p className="flex items-start gap-2 text-sm text-accent-ink-strong">
                    <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-accent-ink" />
                    <span>
                      <span className="block font-medium">Sent. Thank you.</span>
                      It has been recorded and emailed to Bryan.
                    </span>
                  </p>
                ) : (
                  /*
                   * The honest half. The report IS safe -- it is a row in the
                   * database -- but nobody has been told about it, and saying
                   * "sent" would leave someone waiting on a reply that is not
                   * coming.
                   */
                  <p className="flex items-start gap-2 text-sm text-warn-ink-strong">
                    <AlertTriangle size={17} className="mt-0.5 shrink-0" />
                    <span>
                      <span className="block font-medium">Recorded, but not emailed.</span>
                      Your report is saved and will not be lost. The notification did not go
                      out, so tell Bryan directly if it is urgent.
                      {result.emailError ? (
                        <span className="mt-1 block text-xs text-warn-ink">{result.emailError}</span>
                      ) : null}
                    </span>
                  </p>
                )}
                <div className="mt-4 flex justify-end gap-2">
                  <button type="button" onClick={reset}
                    className="px-3 py-2 text-sm text-ink-2 hover:text-ink">
                    Report something else
                  </button>
                  <button type="button" onClick={() => setOpen(false)}
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white">
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-4 p-5">
                <div>
                  <label htmlFor="rp-summary" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-4">
                    What went wrong?
                  </label>
                  <input
                    id="rp-summary"
                    ref={firstFieldRef}
                    className="input"
                    maxLength={LIMITS.summary}
                    value={summary}
                    onChange={(e) => setSummary(e.target.value)}
                    placeholder="The SOL date will not save on Case Info"
                  />
                </div>

                <div>
                  <label htmlFor="rp-severity" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-4">
                    How bad is it?
                  </label>
                  <select id="rp-severity" className="input" value={severity}
                    onChange={(e) => setSeverity(e.target.value)}>
                    {SEVERITIES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </div>

                <div>
                  <label htmlFor="rp-detail" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-4">
                    Anything else <span className="font-normal normal-case text-ink-4">(optional)</span>
                  </label>
                  <textarea
                    id="rp-detail"
                    className="input min-h-[90px]"
                    maxLength={LIMITS.detail}
                    value={detail}
                    onChange={(e) => setDetail(e.target.value)}
                    placeholder="What you were doing, what you expected, what happened instead."
                  />
                </div>

                <p className="text-xs text-ink-3">
                  The page you are on, your browser, and any errors it has already reported are
                  attached automatically — you do not need to describe them.
                </p>

                {/*
                  Said on every report, not only when the destination is
                  outside the firm.

                  The captured context is safe to send anywhere: the page is a
                  path with a UUID in it, which identifies nobody without
                  database access. What is NOT safe is the free text, and this
                  form invites free text. "The SOL for Rivera 26-033 will not
                  save" is a client name, a case number and a deadline, and it
                  is the most natural sentence in the world to write here.

                  Where the report goes is a server-side setting this page
                  cannot see, and asking people to think about privilege only
                  when a variable happens to be set is the wrong way round.
                  A description of the fault does not need the client in it.
                */}
                <p className="rounded border border-warn-line bg-warn-bg px-2.5 py-2 text-xs text-warn-ink-strong">
                  Describe the fault, not the file. Reports may be read outside the firm, so
                  leave out client names, case numbers and anything medical — &ldquo;the SOL
                  field will not save&rdquo; is more useful than which case it was on.
                </p>

                {error ? (
                  <p className="flex items-start gap-1.5 text-sm text-danger-ink">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}
                  </p>
                ) : null}

                <div className="flex justify-end gap-2 border-t border-line-soft pt-4">
                  <button type="button" onClick={() => setOpen(false)}
                    className="px-3 py-2 text-sm text-ink-2 hover:text-ink">
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!summary.trim() || busy}
                    className="flex items-center gap-1.5 rounded-lg bg-accent-solid px-4 py-2 text-sm font-semibold text-white hover:bg-accent-solid-2 disabled:opacity-40"
                  >
                    {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                    {busy ? 'Sending…' : 'Send report'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
