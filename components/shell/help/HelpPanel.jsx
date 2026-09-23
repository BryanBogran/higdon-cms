'use client';

/**
 * The help desk drawer: the list of requests, a new request, or one ticket.
 *
 * Everyone at the firm sees every request -- decided, so people can find
 * what is already reported instead of filing it twice. "Mine" is the default
 * tab for staff because that is what they came to check; the admin lands on
 * everything that is not yet resolved, because that is the work queue.
 */

import { useEffect, useMemo, useState } from 'react';
import { X, Plus, Loader2, AlertTriangle, Inbox } from 'lucide-react';
import { TICKET_STATUSES } from '@/lib/domain/help';
import StatusPill, { ago } from './StatusPill';
import NewRequestForm from './NewRequestForm';
import TicketView from './TicketView';

export default function HelpPanel({ state, listError, view, onView, onClose, onChanged }) {
  const { tickets = [], isAdmin = false, userId = '' } = state || {};
  const [tab, setTab] = useState('mine');
  const [statusFilter, setStatusFilter] = useState('unresolved');

  /*
   * The admin's natural view is the unresolved queue; everyone else's is
   * their own requests, INCLUDING resolved ones.
   *
   * ⚠️ Not "Not resolved" for staff. Finding out a request was resolved is
   * the whole point for them -- and their badge lights for exactly that, so
   * hiding resolved tickets would show a badge of 1 over an empty list.
   */
  useEffect(() => {
    setTab(isAdmin ? 'all' : 'mine');
    setStatusFilter(isAdmin ? 'unresolved' : 'all');
  }, [isAdmin]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const shown = useMemo(() => tickets.filter((t) => {
    if (tab === 'mine' && t.reportedBy !== userId) return false;
    if (statusFilter === 'unresolved') return t.status !== 'resolved';
    if (statusFilter === 'all') return true;
    return t.status === statusFilter;
  }), [tickets, tab, statusFilter, userId]);

  const mineCount = tickets.filter((t) => t.reportedBy === userId).length;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onMouseDown={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Help requests"
        onMouseDown={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-xl flex-col bg-surface text-ink shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-line-soft px-5 py-3">
          <h2 className="font-semibold">
            {view.name === 'new' ? 'New help request' : 'Help requests'}
          </h2>
          <div className="flex items-center gap-2">
            {view.name === 'list' ? (
              <button
                type="button"
                onClick={() => onView({ name: 'new' })}
                className="flex items-center gap-1 rounded-lg bg-accent-solid px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-solid-2"
              >
                <Plus size={14} /> New request
              </button>
            ) : null}
            <button type="button" onClick={onClose} aria-label="Close" className="p-1 text-ink-4 hover:text-ink-2">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {view.name === 'new' ? (
            <NewRequestForm
              onCancel={() => onView({ name: 'list' })}
              onFiled={onChanged}
              onOpenTicket={(id) => onView({ name: 'ticket', id })}
            />
          ) : view.name === 'ticket' ? (
            <TicketView id={view.id} onBack={() => onView({ name: 'list' })} onChanged={onChanged} />
          ) : (
            <div>
              <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-5 py-2.5">
                {[['mine', `Mine (${mineCount})`], ['all', `Everyone (${tickets.length})`]].map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setTab(k)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      tab === k ? 'bg-primary text-white' : 'text-ink-3 hover:bg-hover'
                    }`}
                  >
                    {label}
                  </button>
                ))}
                <select
                  className="ml-auto rounded border border-line-strong bg-surface px-2 py-1 text-xs"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  aria-label="Filter by status"
                >
                  <option value="unresolved">Not resolved</option>
                  <option value="all">All statuses</option>
                  {TICKET_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>

              {listError ? (
                <p className="m-5 flex items-start gap-1.5 text-sm text-danger-ink">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {listError}
                </p>
              ) : !state ? (
                <p className="flex items-center gap-2 p-5 text-sm text-ink-3">
                  <Loader2 size={14} className="animate-spin" /> Loading…
                </p>
              ) : shown.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-5 py-12 text-center text-sm text-ink-4">
                  <Inbox size={22} />
                  {tab === 'mine' ? 'You have no requests here.' : 'No requests here.'}
                </div>
              ) : (
                <ul>
                  {shown.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => onView({ name: 'ticket', id: t.id })}
                        className={`flex w-full items-start gap-3 border-b border-line-soft px-5 py-3 text-left hover:bg-hover ${
                          t.status === 'resolved' ? 'opacity-80' : ''
                        }`}
                      >
                        {/* The dot is the badge, per ticket. */}
                        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${t.unseen ? 'bg-danger-solid' : 'bg-transparent'}`} />
                        <span className="min-w-0 flex-1">
                          <span className={`block truncate text-sm ${t.unseen ? 'font-semibold' : 'font-medium'} text-ink`}>
                            {t.summary}
                          </span>
                          <span className="block text-xs text-ink-3">
                            {t.reportedBy === userId ? 'You' : t.reporterLabel} · {ago(t.lastActivityAt || t.createdAt)}
                            {t.severity === 'blocking' ? <span className="ml-1 font-semibold text-danger-ink">· blocking</span> : null}
                          </span>
                        </span>
                        <StatusPill status={t.status} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
