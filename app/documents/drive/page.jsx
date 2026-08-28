'use client';

/**
 * Google Drive sync — dry run, link, then resolve what could not be decided.
 *
 * There used to be a fourth step that walked every linked folder and copied a
 * file index into Postgres. It is gone: documents are read live from Drive when
 * someone opens a case, so there is no copy to keep current.
 *
 * The order on screen is the order the work happens in, and the dry run is
 * first because it is the one step that cannot do damage. "It silently
 * attached two hundred folders to cases" is not a thing to find out about
 * afterwards, so the numbers are shown and a human presses the button.
 *
 * The review queue below is the other half of the matching rule: the matcher
 * refuses to guess, and that refusal is only defensible if deciding by hand is
 * a five-second dropdown. If this screen were tedious, the right fix would be
 * to make it less tedious — never to make the matcher braver.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  FolderSync, Loader2, AlertCircle, CheckCircle2, ArrowLeft, X, RefreshCw,
} from 'lucide-react';
import { useData } from '@/lib/data/DataProvider';
import { matterTitle } from '@/lib/domain/matter';

export default function DriveSyncPage() {
  const { matters, loaded } = useData();

  const [plan, setPlan] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const loadReviews = useCallback(async () => {
    const res = await fetch('/api/drive/review');
    const body = await res.json().catch(() => ({}));
    if (res.ok) setReviews(body.reviews || []);
  }, []);

  useEffect(() => { loadReviews(); }, [loadReviews]);

  async function call(url, init, label) {
    setBusy(label);
    setError('');
    setNote('');
    try {
      const res = await fetch(url, init);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || `Request failed (${res.status}).`);
        return null;
      }
      return body;
    } catch (err) {
      setError(err?.message || 'Request failed.');
      return null;
    } finally {
      setBusy('');
    }
  }

  async function dryRun() {
    const body = await call('/api/drive/sync', {}, 'plan');
    if (body) setPlan(body);
  }

  async function applyLinks() {
    const body = await call(
      '/api/drive/sync',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ step: 'link' }) },
      'link'
    );
    if (!body) return;
    setNote(`Linked ${body.linked} folder${body.linked === 1 ? '' : 's'}. ${body.queuedForReview} need a decision.`);
    setPlan(null);
    loadReviews();
  }

  async function resolve(folderId, folderName, matterId) {
    const body = await call(
      '/api/drive/review',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ folderId, folderName, matterId }),
      },
      folderId
    );
    if (body) {
      setNote("Linked. Its documents appear on the case's Docs tab straight away.");
      loadReviews();
    }
  }

  async function dismiss(folderId) {
    const body = await call(
      '/api/drive/review',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ folderId, dismiss: true }) },
      folderId
    );
    if (body) loadReviews();
  }

  const unlinked = Object.entries(matters)
    .filter(([, m]) => !m?.archivedAt && !m?.driveFolderId)
    .map(([id, m]) => ({ id, title: matterTitle(m) }))
    .sort((a, b) => a.title.localeCompare(b.title));

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <Link href="/documents" className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 mb-4">
        <ArrowLeft size={15} /> Documents
      </Link>

      <h1 className="text-2xl font-bold text-slate-900">Google Drive sync</h1>
      <p className="mt-1 text-sm text-slate-600">
        Links each case to its Drive folder. Documents themselves are read live from Drive when
        a case is opened — nothing is copied, moved or renamed.
      </p>

      {error ? (
        <p className="mt-4 flex items-start gap-1.5 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle size={15} className="mt-0.5 shrink-0" /> {error}
        </p>
      ) : null}
      {note ? (
        <p className="mt-4 flex items-start gap-1.5 rounded border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-800">
          <CheckCircle2 size={15} className="mt-0.5 shrink-0" /> {note}
        </p>
      ) : null}

      {/* ---- Step 1: dry run ---- */}
      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="font-semibold text-slate-900">1 · See what would happen</h2>
        <p className="mt-1 text-sm text-slate-600">
          Reads Drive and matches folders to cases. Writes nothing.
        </p>
        <button
          onClick={dryRun}
          disabled={Boolean(busy)}
          className="mt-3 flex items-center gap-2 px-4 py-2 rounded border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {busy === 'plan' ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          Dry run
        </button>

        {plan ? (
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            <Stat label="Folders found" value={plan.folders} />
            <Stat label="Will link" value={plan.counts.willLink} tone="teal" />
            <Stat label="Need a decision" value={plan.counts.needsReview} tone="amber" />
            <Stat label="Already linked" value={plan.counts.alreadyLinked} />
          </div>
        ) : null}

        {plan?.folders === 0 ? (
          <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm">
            <p className="font-semibold text-amber-900">No folders found under the root.</p>
            {/*
              Drive returns 404 for "does not exist" and for "you may not see
              it" alike, and lists a folder you cannot see as empty. So the
              server asks three follow-up questions and reports which cause it
              actually is, rather than this page listing possibilities.
            */}
            <p className="mt-1 text-amber-800">
              {plan.diagnosis?.diagnosis || 'Could not reach Drive to work out why.'}
            </p>
            {plan.diagnosis ? (
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-amber-800">
                <dt>Acting as</dt>
                <dd className="font-mono break-all">{plan.diagnosis.actingAs}</dd>
                <dt>Root folder id</dt>
                <dd className="font-mono break-all">{plan.diagnosis.rootFolderId || '(not set)'}</dd>
                <dt>Root visible</dt>
                <dd>{plan.diagnosis.rootVisible ? `yes — “${plan.diagnosis.rootName}”` : 'no'}</dd>
                <dt>Can see anything at all</dt>
                <dd>
                  {plan.diagnosis.canSeeAnything
                    ? `yes (${plan.diagnosis.visibleSample.join(', ')})`
                    : 'no — nothing is shared with this account'}
                </dd>
                {plan.diagnosis.rootVisible ? (
                  <>
                    <dt>Items inside</dt>
                    <dd>
                      {plan.diagnosis.childCount} ({plan.diagnosis.childFolders} folder
                      {plan.diagnosis.childFolders === 1 ? '' : 's'})
                    </dd>
                  </>
                ) : null}
              </dl>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* ---- Step 2: apply ---- */}
      <section className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="font-semibold text-slate-900">2 · Link the unambiguous ones</h2>
        <p className="mt-1 text-sm text-slate-600">
          Only where exactly one case matches and nothing else is close. Everything else drops into
          the queue below.
        </p>
        <div className="mt-3">
          <button
            onClick={applyLinks}
            disabled={Boolean(busy)}
            className="flex items-center gap-2 px-4 py-2 rounded bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
          >
            {busy === 'link' ? <Loader2 size={15} className="animate-spin" /> : <FolderSync size={15} />}
            Link folders
          </button>
        </div>
        {/*
          There used to be an "Index files" button here, and a batch that
          walked twenty cases at a time. Both are gone: documents are read
          live from Drive when someone opens them, so there is no copy to
          keep current and nothing to press.
        */}
        <p className="mt-2 text-xs text-slate-500">
          Linking is all that is needed. Documents themselves are read straight from Drive when
          a case is opened, so nothing here can fall behind.
        </p>
      </section>

      {/* ---- Step 3: review ---- */}
      <section className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="font-semibold text-slate-900">
          3 · Folders needing a decision{reviews.length ? ` (${reviews.length})` : ''}
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          The matcher will not guess between two clients with the same name. Filing medical records
          on the wrong case is a privilege breach; this dropdown is five seconds.
        </p>

        {!loaded ? (
          <p className="mt-4 text-sm text-slate-400">Loading…</p>
        ) : reviews.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">Nothing waiting.</p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100">
            {reviews.map((r) => (
              <li key={r.folder_id} className="py-3 flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900 truncate">{r.folder_name}</p>
                  <p className="text-xs text-slate-500">
                    {r.reason === 'ambiguous'
                      ? `${(r.candidates || []).length} possible match${(r.candidates || []).length === 1 ? '' : 'es'}`
                      : 'No matching case'}
                  </p>
                </div>

                <select
                  defaultValue=""
                  disabled={busy === r.folder_id}
                  onChange={(e) => e.target.value && resolve(r.folder_id, r.folder_name, e.target.value)}
                  className="input w-auto max-w-xs text-sm"
                >
                  <option value="">Link to a case…</option>
                  {/* Suggestions first: for an ambiguous folder these are the
                      names that collided, which is exactly what the person
                      needs to compare. */}
                  {(r.candidates || []).length ? (
                    <optgroup label="Suggested">
                      {r.candidates.map((c) => (
                        <option key={c.matterId} value={c.matterId}>{c.name} — {c.why}</option>
                      ))}
                    </optgroup>
                  ) : null}
                  <optgroup label="All cases without a folder">
                    {unlinked.map((m) => (
                      <option key={m.id} value={m.id}>{m.title}</option>
                    ))}
                  </optgroup>
                </select>

                <button
                  onClick={() => dismiss(r.folder_id)}
                  disabled={busy === r.folder_id}
                  title="Not a case folder — stop asking about it"
                  className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                >
                  <X size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, tone }) {
  const colour =
    tone === 'teal' ? 'text-teal-700' : tone === 'amber' ? 'text-amber-700' : 'text-slate-900';
  return (
    <div className="rounded border border-slate-200 px-3 py-2">
      <p className={`text-xl font-bold ${colour}`}>{value}</p>
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
    </div>
  );
}
