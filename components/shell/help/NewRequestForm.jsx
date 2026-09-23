'use client';

/**
 * The form for filing a help request.
 *
 * Moved here unchanged from the old ReportProblem dialog, with one addition:
 * once filed, the request opens as a ticket, so the person can see it is
 * there, see its status, and come back to it.
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
import { Loader2, CheckCircle2, AlertTriangle, Send } from 'lucide-react';
import { SEVERITIES, LIMITS } from '@/lib/domain/report';
import { recentErrors } from '@/lib/client-errors';

export default function NewRequestForm({ onCancel, onFiled, onOpenTicket }) {
  const [summary, setSummary] = useState('');
  const [detail, setDetail] = useState('');
  const [severity, setSeverity] = useState('normal');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const firstFieldRef = useRef(null);

  useEffect(() => { setTimeout(() => firstFieldRef.current?.focus(), 50); }, []);

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
          page: window.location.pathname + window.location.search,
          userAgent: navigator.userAgent,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          consoleErrors: recentErrors(),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error || `Could not send that (${res.status}).`); return; }
      setResult(body);
      onFiled?.();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="p-5">
        {result.emailed ? (
          <p className="flex items-start gap-2 text-sm text-accent-ink-strong">
            <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-accent-ink" />
            <span>
              <span className="block font-medium">Sent. Thank you.</span>
              It is recorded and Bryan has been emailed. You can follow its status
              here — you will get an email when he replies or it is resolved.
            </span>
          </p>
        ) : (
          /*
           * The honest half. The report IS safe -- it is a row in the
           * database -- but nobody has been told about it, and saying "sent"
           * would leave someone waiting on a reply that is not coming.
           */
          <p className="flex items-start gap-2 text-sm text-warn-ink-strong">
            <AlertTriangle size={17} className="mt-0.5 shrink-0" />
            <span>
              <span className="block font-medium">Recorded, but not emailed.</span>
              Your request is saved and will not be lost. The notification did not go
              out, so tell Bryan directly if it is urgent.
              {result.emailError ? (
                <span className="mt-1 block text-xs text-warn-ink">{result.emailError}</span>
              ) : null}
            </span>
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={reset} className="px-3 py-2 text-sm text-ink-2 hover:text-ink">
            Report something else
          </button>
          {result.id ? (
            <button
              type="button"
              onClick={() => onOpenTicket?.(result.id)}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white"
            >
              View request
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
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
        <select id="rp-severity" className="input" value={severity} onChange={(e) => setSeverity(e.target.value)}>
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
        Said on every report, and now for two reasons rather than one: the
        request is emailed to whoever BUG_REPORT_TO names, which may be
        outside the firm, AND everyone at the firm can now see every request.
        The free text is exactly where a client name ends up -- "the SOL for
        Rivera 26-033 will not save" is the most natural sentence in the world
        to write here -- and a description of the fault does not need it.
      */}
      <p className="rounded border border-warn-line bg-warn-bg px-2.5 py-2 text-xs text-warn-ink-strong">
        Describe the fault, not the file. Everyone at the firm can see help requests and
        they may be read outside the firm, so leave out client names, case numbers and
        anything medical — &ldquo;the SOL field will not save&rdquo; is more useful than
        which case it was on.
      </p>

      {error ? (
        <p className="flex items-start gap-1.5 text-sm text-danger-ink">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}
        </p>
      ) : null}

      <div className="flex justify-end gap-2 border-t border-line-soft pt-4">
        <button type="button" onClick={onCancel} className="px-3 py-2 text-sm text-ink-2 hover:text-ink">
          Cancel
        </button>
        <button
          type="submit"
          disabled={!summary.trim() || busy}
          className="flex items-center gap-1.5 rounded-lg bg-accent-solid px-4 py-2 text-sm font-semibold text-white hover:bg-accent-solid-2 disabled:opacity-40"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          {busy ? 'Sending…' : 'Send request'}
        </button>
      </div>
    </form>
  );
}
