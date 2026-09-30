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

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { FileText, Loader2, AlertTriangle, X, ChevronDown, Check } from 'lucide-react';
import { useData } from '@/lib/data/DataProvider';

/**
 * Generating one template for one row: the request, the checks, and the
 * dialog. Shared by the labelled button and the "More letters" menu, so
 * both refuse, confirm and file in exactly the same way.
 */
function useDocGenerator({ matterId, template, row, existing }) {
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
       * A 200 with no file is not a success. An expired session is answered
       * by the sign-in redirect -- a 200 HTML page -- and this used to read
       * that as done and show nothing: a click that did nothing, silently.
       */
      if (!body.file) {
        setError(res.redirected
          ? 'You have been signed out. Sign in again, then generate the letter.'
          : 'The document could not be generated.');
        return;
      }

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

  return { start, busy, dialog, open: Boolean(dialog) };
}

export default function GenerateDoc({ matterId, template, row, existing }) {
  const { start, busy, dialog } = useDocGenerator({ matterId, template, row, existing });
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

/**
 * One menu item's run: starts on mount, reports when it is finished.
 *
 * Mounted only while a letter from the menu is being made, so the menu can
 * close the moment an item is picked while the request, and any dialog it
 * raises, carry on here.
 */
function MenuRun({ matterId, template, row, onBusy, onDone }) {
  const gen = useDocGenerator({ matterId, template, row, existing: row[template.targetField] });
  const kicked = useRef(false);

  // ⚠️ ORDER MATTERS: this runs before the kick below in the first commit,
  // while nothing has started, so it cannot report "done" before the start.
  useEffect(() => {
    onBusy?.(gen.busy);
    if (kicked.current && !gen.busy && !gen.open) onDone();
  }, [gen.busy, gen.open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // A ref, not state: StrictMode runs effects twice in development, and a
    // second start would be a second letter.
    if (kicked.current) return;
    kicked.current = true;
    gen.start();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return gen.dialog;
}

/**
 * The letters that are not everyday buttons, behind one "More letters".
 *
 * Med Req and LOP are clicked many times a day and stay buttons. The
 * letters that close a provider out go here -- three more buttons on every
 * provider card would be the clutter the cards were built to remove.
 * A tick shows the ones already filed on this row.
 *
 * The list is FIXED-positioned from the button, not absolutely: in the table
 * view the button sits in a scrolling container, which would clip it.
 */
function LettersMenu({ matterId, templates, row }) {
  const [pos, setPos] = useState(null);           // open when set
  const [active, setActive] = useState(null);     // { template, run }
  const [busy, setBusy] = useState(false);
  const buttonRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (!pos) return undefined;
    const close = (e) => {
      if (e.type === 'keydown' && e.key !== 'Escape') return;
      if (e.type === 'mousedown' && (buttonRef.current?.contains(e.target) || listRef.current?.contains(e.target))) return;
      setPos(null);
    };
    const shut = () => setPos(null);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    window.addEventListener('resize', shut);
    window.addEventListener('scroll', shut, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
      window.removeEventListener('resize', shut);
      window.removeEventListener('scroll', shut, true);
    };
  }, [pos]);

  function toggle() {
    if (pos) { setPos(null); return; }
    const r = buttonRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
  }

  function pick(template) {
    setPos(null);
    setActive({ template, run: Date.now() });
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={Boolean(pos)}
        className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-line-strong px-2 py-1 text-[11px] font-semibold text-ink-2 transition hover:border-accent-solid hover:text-accent-ink disabled:opacity-50"
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
        More letters
        <ChevronDown size={12} />
      </button>

      {pos ? (
        <div
          ref={listRef}
          role="menu"
          style={{ position: 'fixed', top: pos.top, right: pos.right }}
          className="z-40 w-60 rounded-lg border border-line bg-surface py-1 shadow-lg"
        >
          {templates.map((t) => {
            const filed = row[t.targetField];
            return (
              <button
                key={t.key}
                type="button"
                role="menuitem"
                onClick={() => pick(t)}
                title={filed?.name ? `Already filed: ${filed.name}` : `Generate the ${t.label} for this row`}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink-2 hover:bg-hover hover:text-ink"
              >
                <FileText size={14} className="shrink-0 text-ink-4" />
                <span className="flex-1">{t.label}</span>
                {filed?.name || filed?.id ? <Check size={14} className="shrink-0 text-ok-ink" aria-label="already filed" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {active ? (
        <MenuRun
          key={active.run}
          matterId={matterId}
          template={active.template}
          row={row}
          onBusy={setBusy}
          onDone={() => { setActive(null); setBusy(false); }}
        />
      ) : null}
    </>
  );
}

/**
 * Every document a row can produce: the everyday ones as buttons, the rest
 * in "More letters". The one component the card, the editor and the table
 * all render, so they cannot drift apart.
 */
export function DocButtons({ matterId, templates = [], row }) {
  const buttons = templates.filter((t) => !t.menu);
  const menu = templates.filter((t) => t.menu);
  return (
    <>
      {buttons.map((t) => (
        <GenerateDoc key={t.key} matterId={matterId} template={t} row={row} existing={row[t.targetField]} />
      ))}
      {menu.length ? <LettersMenu matterId={matterId} templates={menu} row={row} /> : null}
    </>
  );
}
