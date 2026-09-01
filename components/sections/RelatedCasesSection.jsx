'use client';

/**
 * Related Cases — other matters connected to this one.
 *
 * The link is UNDIRECTED: "A is related to B" and "B is related to A" are the
 * same fact, stored once. So this reads links made from either end, and a case
 * added here appears on the other case immediately without anyone entering it
 * twice. `matter_relation_pair_uq` in 005_sections.sql enforces the same thing
 * in the database, normalising the pair so a duplicate entered from the far end
 * is refused.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, Trash2, ArrowRight } from 'lucide-react';
import { useData } from '@/lib/data/DataProvider';
import { matterTitle } from '@/lib/domain/matter';
import { fmt } from '@/lib/domain/dates';

const KINDS = ['Same Incident', 'Same Client', 'Companion Suit', 'Subrogation', 'Related'];

export default function RelatedCasesSection({ matterId }) {
  const { matters, relations, addRelation, removeRelation } = useData();
  const [toId, setToId] = useState('');
  const [kind, setKind] = useState('Same Incident');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  // Either end counts — that is what "undirected" means in practice.
  const linked = useMemo(
    () =>
      (relations || [])
        .filter((r) => r.fromId === matterId || r.toId === matterId)
        .map((r) => ({ ...r, otherId: r.fromId === matterId ? r.toId : r.fromId }))
        .filter((r) => matters[r.otherId]),
    [relations, matters, matterId]
  );

  const linkedIds = new Set(linked.map((r) => r.otherId));

  const options = useMemo(
    () =>
      Object.entries(matters)
        // A case cannot be related to itself, and one already linked must not
        // be offered again — both are refused by the database anyway, but an
        // option that can only fail is not worth showing.
        .filter(([id, m]) => id !== matterId && !m?.archivedAt && !linkedIds.has(id))
        .map(([id, m]) => ({ id, title: matterTitle(m) }))
        .sort((a, b) => a.title.localeCompare(b.title)),
    [matters, matterId, linkedIds]
  );

  async function submit() {
    if (!toId) return;
    setError('');
    const res = await addRelation({ fromId: matterId, toId, kind, note: note.trim() });
    if (!res.ok) {
      setError(res.error || 'Could not link that case.');
      return;
    }
    setToId('');
    setNote('');
  }

  return (
    <div className="bg-surface rounded-xl border border-line shadow-sm">
      <div className="px-5 py-3 border-b border-line-soft flex items-center justify-between">
        <h2 className="font-semibold text-ink">Related Cases</h2>
        <span className="text-sm text-ink-3">
          {linked.length} {linked.length === 1 ? 'case' : 'cases'}
        </span>
      </div>

      {linked.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-ink-4">
          No related cases. Link one below — it will show on both files.
        </p>
      ) : (
        <ul className="divide-y divide-line-soft">
          {linked.map((r) => {
            const other = matters[r.otherId];
            return (
              <li key={r.id} className="px-5 py-3 flex flex-wrap items-center gap-3">
                <span className="px-2 py-0.5 rounded bg-raised text-ink-2 text-xs shrink-0">
                  {r.kind}
                </span>
                <Link
                  href={`/matters/${r.otherId}`}
                  className="font-medium text-accent-ink hover:underline min-w-0 truncate"
                >
                  {matterTitle(other)}
                </Link>
                <span className="text-xs text-ink-3">
                  {other?.values?.status || '—'}
                  {other?.values?.doa ? ` · DOA ${fmt(other.values.doa)}` : ''}
                </span>
                {r.note ? <span className="text-xs text-ink-3 italic">“{r.note}”</span> : null}
                <div className="flex-1" />
                <Link href={`/matters/${r.otherId}`} className="text-ink-4 hover:text-ink-2" title="Open">
                  <ArrowRight size={16} />
                </Link>
                <button
                  onClick={() => removeRelation(r.id)}
                  className="p-1.5 text-ink-4 hover:text-danger-ink"
                  title="Unlink"
                >
                  <Trash2 size={15} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="px-5 py-3 border-t border-line-soft bg-canvas/60 flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-4 mb-1">
            Case
          </label>
          <select className="input" value={toId} onChange={(e) => setToId(e.target.value)}>
            <option value="">Choose a case…</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>{o.title}</option>
            ))}
          </select>
        </div>
        <div className="min-w-[150px]">
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-4 mb-1">
            Relationship
          </label>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
        <div className="min-w-[180px] flex-1">
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-4 mb-1">
            Note
          </label>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </div>
        <button
          onClick={submit}
          disabled={!toId}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-2 disabled:opacity-40"
        >
          <Plus size={15} /> Link
        </button>
      </div>

      {error ? <p className="px-5 pb-3 text-sm text-danger-ink">{error}</p> : null}
    </div>
  );
}
