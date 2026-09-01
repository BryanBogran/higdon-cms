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
        className="p-2 rounded text-slate-300 hover:bg-white/10 hover:text-white"
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
            className="mt-16 w-full max-w-lg rounded-xl bg-white text-slate-900 shadow-2xl"
          >
            <div className="flex items-start justify-between border-b border-slate-100 px-5 py-3">
              <h2 className="font-semibold">Report a problem</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close"
                className="p-1 text-slate-400 hover:text-slate-700">
                <X size={18} />
              </button>
            </div>

            {result ? (
              <div className="p-5">
                {result.emailed ? (
                  <p className="flex items-start gap-2 text-sm text-teal-800">
                    <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-teal-600" />
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
                  <p className="flex items-start gap-2 text-sm text-amber-800">
                    <AlertTriangle size={17} className="mt-0.5 shrink-0" />
                    <span>
                      <span className="block font-medium">Recorded, but not emailed.</span>
                      Your report is saved and will not be lost. The notification did not go
                      out, so tell Bryan directly if it is urgent.
                      {result.emailError ? (
                        <span className="mt-1 block text-xs text-amber-700">{result.emailError}</span>
                      ) : null}
                    </span>
                  </p>
                )}
                <div className="mt-4 flex justify-end gap-2">
                  <button type="button" onClick={reset}
                    className="px-3 py-2 text-sm text-slate-600 hover:text-slate-900">
                    Report something else
                  </button>
                  <button type="button" onClick={() => setOpen(false)}
                    className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-4 p-5">
                <div>
                  <label htmlFor="rp-summary" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">
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
                  <label htmlFor="rp-severity" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    How bad is it?
                  </label>
                  <select id="rp-severity" className="input" value={severity}
                    onChange={(e) => setSeverity(e.target.value)}>
                    {SEVERITIES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </div>

                <div>
                  <label htmlFor="rp-detail" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Anything else <span className="font-normal normal-case text-slate-400">(optional)</span>
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

                <p className="text-xs text-slate-500">
                  The page you are on, your browser, and any errors it has already reported are
                  attached automatically — you do not need to describe them.
                </p>

                {error ? (
                  <p className="flex items-start gap-1.5 text-sm text-rose-700">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}
                  </p>
                ) : null}

                <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                  <button type="button" onClick={() => setOpen(false)}
                    className="px-3 py-2 text-sm text-slate-600 hover:text-slate-900">
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!summary.trim() || busy}
                    className="flex items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500 disabled:opacity-40"
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
