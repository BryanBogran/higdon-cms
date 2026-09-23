'use client';

/**
 * The help button in the top bar, and the badge that says something changed.
 *
 * ── It has to work when the app does not ──────────────────────────────────
 *
 * This is the control people reach for precisely when something is broken,
 * so it keeps its dependencies minimal: plain routes, never DataProvider, and
 * it lives in the top bar, which survives a section component crashing.
 * Filing a NEW request works even before migration 022 has run -- only the
 * list and the thread need it.
 *
 * ── The badge ─────────────────────────────────────────────────────────────
 *
 * Counts requests with news you have not seen: a reply or a status change on
 * yours, or -- for the admin -- anything on an unresolved ticket. The rule
 * lives in lib/domain/help.js `isUnseen`, where it is tested; this only
 * asks the server for the count. Refreshed on load, on returning to the tab,
 * and every few minutes, which is plenty for a queue of this size and costs
 * nothing like a live subscription would.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { LifeBuoy } from 'lucide-react';
import { installErrorCapture } from '@/lib/client-errors';
import HelpPanel from './HelpPanel';

const REFRESH_MS = 3 * 60 * 1000;

export default function HelpButton() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState({ name: 'list' });
  const [state, setState] = useState(null);          // { tickets, unseen, isAdmin, userId }
  const [listError, setListError] = useState('');
  const disabled = useRef(false);                    // signed out, or no database

  useEffect(() => { installErrorCapture(); }, []);

  const refresh = useCallback(async () => {
    if (disabled.current) return;
    try {
      const res = await fetch('/api/help', { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401 || res.status === 503) { disabled.current = true; return; }
      if (!res.ok) { setListError(body.error || 'Help requests could not be loaded.'); return; }
      setListError('');
      setState(body);
    } catch {
      // Offline, or the server is down. The badge simply does not update.
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [refresh]);

  /*
   * ── ?help=<id> opens that ticket ──────────────────────────────────────
   *
   * The link in every help email. Read off window.location rather than
   * useSearchParams, for the reason app/projects/page.jsx gives, and stripped
   * once used so Back does not reopen it.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('help');
    if (!id) return;
    setView({ name: 'ticket', id });
    setOpen(true);
    params.delete('help');
    const rest = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${rest ? `?${rest}` : ''}`);
  }, []);

  const close = useCallback(() => { setOpen(false); refresh(); }, [refresh]);

  const unseen = state?.unseen || 0;

  return (
    <>
      <button
        type="button"
        onClick={() => { setView({ name: 'list' }); setOpen(true); refresh(); }}
        title={unseen ? `Help requests — ${unseen} with news` : 'Help requests'}
        aria-label={unseen ? `Help requests, ${unseen} with news` : 'Help requests'}
        className="relative p-2 rounded text-chrome-muted hover:bg-white/10 hover:text-white"
      >
        <LifeBuoy size={18} />
        {unseen ? (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-danger-solid px-1 text-[10px] font-bold leading-none text-white">
            {unseen > 9 ? '9+' : unseen}
          </span>
        ) : null}
      </button>

      {open ? (
        <HelpPanel
          state={state}
          listError={listError}
          view={view}
          onView={setView}
          onClose={close}
          onChanged={refresh}
        />
      ) : null}
    </>
  );
}
