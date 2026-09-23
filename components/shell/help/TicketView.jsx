'use client';

/**
 * One help request: what was reported, its status, and the conversation.
 *
 * The admin sees a status control; everyone else sees the status as a pill.
 * That split is cosmetic -- the database refuses a status change from
 * anybody else regardless (supabase/022_help_tickets.sql) -- but offering a
 * control that will be refused is worse than not offering it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Loader2, Send, AlertTriangle, ChevronDown, ChevronRight, CheckCircle2 } from 'lucide-react';
import { TICKET_STATUSES, STATUS_BY_KEY, statusLabel } from '@/lib/domain/help';
import StatusPill, { TONE, ago } from './StatusPill';

export default function TicketView({ id, onBack, onChanged }) {
  const [data, setData] = useState(null);       // { ticket, replies, isAdmin, userId }
  const [loadError, setLoadError] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');         // '' | 'reply' | status key
  const [note, setNote] = useState(null);       // { tone, text } after an action
  const [showContext, setShowContext] = useState(false);

  /*
   * ⚠️ Held in a ref, NOT listed as an effect dependency. The parent refetches
   * its list when told something changed, which re-renders it, which can hand
   * down a fresh callback -- and if that re-ran the "mark seen" effect below,
   * the two would chase each other in a loop of requests for as long as the
   * panel was open.
   */
  const changed = useRef(onChanged);
  changed.current = onChanged;

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/help?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setLoadError(body.error || 'That request could not be opened.'); return; }
      setData(body);
    } catch {
      setLoadError('Could not reach the server.');
    }
  }, [id]);

  useEffect(() => {
    load();
    // Opening it is reading it -- the badge goes out for this one.
    fetch('/api/help', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'seen', id }),
    }).then(() => changed.current?.()).catch(() => {});
  }, [id, load]);

  async function post(payload, kind) {
    setBusy(kind);
    setNote(null);
    try {
      const res = await fetch('/api/help', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, ...payload }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setNote({ tone: 'danger', text: body.error || 'That did not save.' }); return false; }

      /*
       * Saved is saved. If the email did not go out, say so plainly -- the
       * other person will not know to look, and that is the failure this whole
       * feature exists to prevent.
       */
      if (body.emailError) {
        setNote({ tone: 'warn', text: `Saved, but the email did not go out: ${body.emailError}` });
      } else if (body.emailed) {
        setNote({ tone: 'ok', text: 'Saved, and they have been emailed.' });
      }
      await load();
      changed.current?.();
      return true;
    } catch {
      setNote({ tone: 'danger', text: 'Could not reach the server. Nothing was saved.' });
      return false;
    } finally {
      setBusy('');
    }
  }

  async function sendReply(e) {
    e.preventDefault();
    if (!text.trim() || busy) return;
    if (await post({ action: 'reply', body: text }, 'reply')) setText('');
  }

  if (loadError) {
    return (
      <div className="p-5">
        <BackButton onBack={onBack} />
        <p className="mt-4 flex items-start gap-1.5 text-sm text-danger-ink">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {loadError}
        </p>
      </div>
    );
  }
  if (!data) {
    return <p className="flex items-center gap-2 p-5 text-sm text-ink-3"><Loader2 size={14} className="animate-spin" /> Loading…</p>;
  }

  const { ticket, replies, isAdmin, userId } = data;
  const resolved = ticket.status === 'resolved';

  return (
    <div className="flex h-full flex-col">
      {/* Header. Resolved tickets turn green across the whole band. */}
      <div className={`border-b px-5 py-4 ${resolved ? 'border-ok-line bg-ok-bg' : 'border-line-soft'}`}>
        <BackButton onBack={onBack} />
        <div className="mt-2 flex items-start justify-between gap-3">
          <h3 className="font-semibold text-ink">{ticket.summary}</h3>
          <StatusPill status={ticket.status} />
        </div>
        <p className="mt-1 text-xs text-ink-3">
          {ticket.reporterLabel}{ticket.reportedBy === userId ? ' (you)' : ''} · {ago(ticket.createdAt)}
          {ticket.severity === 'blocking' ? <span className="ml-1.5 font-semibold text-danger-ink">· blocking</span> : null}
        </p>
        {resolved ? (
          <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-ok-ink">
            <CheckCircle2 size={14} /> Resolved {ago(ticket.resolvedAt)}. Reply if it is still happening and it will reopen.
          </p>
        ) : null}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {/* The admin's control. Everyone else just sees the pill above. */}
        {isAdmin ? (
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-4">Status</p>
            <div className="flex flex-wrap gap-1.5">
              {TICKET_STATUSES.map((s) => {
                const on = ticket.status === s.key;
                return (
                  <button
                    key={s.key}
                    type="button"
                    disabled={Boolean(busy) || on}
                    onClick={() => post({ action: 'status', status: s.key }, s.key)}
                    title={s.blurb}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold transition ${
                      on ? `${TONE[s.tone]} ring-2 ring-offset-1 ring-current` : 'border-line-strong text-ink-3 hover:text-ink'
                    } disabled:cursor-default`}
                  >
                    {busy === s.key ? <Loader2 size={12} className="animate-spin" /> : null}
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="text-xs text-ink-3">{STATUS_BY_KEY[ticket.status]?.blurb}</p>
        )}

        {ticket.detail ? (
          <p className="whitespace-pre-wrap rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink-2">
            {ticket.detail}
          </p>
        ) : null}

        {/* What was captured automatically. Useful to the admin, noise to most. */}
        <div>
          <button
            type="button"
            onClick={() => setShowContext((v) => !v)}
            className="flex items-center gap-1 text-xs text-ink-3 hover:text-ink-2"
          >
            {showContext ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Technical details
          </button>
          {showContext ? (
            <dl className="mt-2 space-y-1 rounded-lg border border-line bg-canvas px-3 py-2 text-xs text-ink-3">
              <div><dt className="inline font-semibold">Page: </dt><dd className="inline break-all">{ticket.page || '—'}</dd></div>
              <div><dt className="inline font-semibold">Browser: </dt><dd className="inline break-all">{ticket.userAgent || '—'}</dd></div>
              <div><dt className="inline font-semibold">Window: </dt><dd className="inline">{ticket.viewport || '—'}</dd></div>
              <div>
                <dt className="font-semibold">Errors:</dt>
                {ticket.consoleErrors.length
                  ? ticket.consoleErrors.map((e, i) => <dd key={i} className="break-all">· {e}</dd>)
                  : <dd>None reported.</dd>}
              </div>
            </dl>
          ) : null}
        </div>

        {/* The conversation, with status changes as a timeline between replies. */}
        <div className="space-y-3">
          {replies.length === 0 ? (
            <p className="text-xs text-ink-4">No replies yet.</p>
          ) : replies.map((r) => (
            r.kind === 'status' ? (
              <p key={r.id} className="text-center text-[11px] text-ink-4">
                {r.body || `${r.authorLabel} marked this ${statusLabel(r.status)}`} · {ago(r.createdAt)}
              </p>
            ) : (
              <div key={r.id} className={`flex ${r.authorId === userId ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                  r.authorId === userId ? 'bg-accent-bg text-ink' : 'border border-line bg-surface text-ink'
                }`}>
                  <p className="mb-0.5 text-[11px] font-semibold text-ink-3">
                    {r.authorId === userId ? 'You' : r.authorLabel} · {ago(r.createdAt)}
                  </p>
                  <p className="whitespace-pre-wrap">{r.body}</p>
                </div>
              </div>
            )
          ))}
        </div>
      </div>

      <form onSubmit={sendReply} className="border-t border-line-soft px-5 py-3">
        {note ? (
          <p className={`mb-2 text-xs ${note.tone === 'danger' ? 'text-danger-ink' : note.tone === 'warn' ? 'text-warn-ink-strong' : 'text-ok-ink'}`}>
            {note.text}
          </p>
        ) : null}
        <textarea
          className="input min-h-[70px]"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={isAdmin && ticket.reportedBy !== userId
            ? `Reply to ${ticket.reporterLabel}… they will be emailed.`
            : 'Reply…'}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendReply(e); }}
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[11px] text-ink-4">⌘/Ctrl + Enter to send</span>
          <button
            type="submit"
            disabled={!text.trim() || Boolean(busy)}
            className="flex items-center gap-1.5 rounded-lg bg-accent-solid px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-solid-2 disabled:opacity-40"
          >
            {busy === 'reply' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Send
          </button>
        </div>
      </form>
    </div>
  );
}

function BackButton({ onBack }) {
  return (
    <button type="button" onClick={onBack} className="flex items-center gap-1 text-xs text-ink-3 hover:text-ink">
      <ArrowLeft size={13} /> All requests
    </button>
  );
}
