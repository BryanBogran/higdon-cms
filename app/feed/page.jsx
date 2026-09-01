'use client';

/**
 * Feed -- firm-wide activity across every matter.
 *
 * Same ActivityCard as the matter Activity section and the Tasks list, because
 * they are all rows in one table. The rail is kind-filters with live counts, and
 * entries group by Pinned / Today / Earlier with per-group counts, as Filevine
 * does.
 */

import { useMemo, useState } from 'react';
import { Zap, FileText, MessageSquare, Mail, Printer, Phone, MessageCircle, CheckSquare, Bell } from 'lucide-react';
import RailLayout, { RailItem } from '@/components/shell/RailLayout';
import ActivityCard from '@/components/activity/ActivityCard';
import ActivityComposer from '@/components/activity/ActivityComposer';
import { useData } from '@/lib/data/DataProvider';
import { todayInFirmTz } from '@/lib/domain/dates';

const KINDS = [
  { key: 'all', label: 'All', icon: Zap },
  { key: 'note', label: 'Notes', icon: FileText },
  { key: 'message', label: 'Messages', icon: MessageSquare },
  { key: 'email', label: 'Emails', icon: Mail },
  { key: 'fax', label: 'Faxes', icon: Printer },
  { key: 'call', label: 'Phone Calls', icon: Phone },
  { key: 'text', label: 'Texts', icon: MessageCircle },
  { key: 'task', label: 'Tasks', icon: CheckSquare },
  { key: 'reminder', label: 'Reminders', icon: Bell },
];

export default function FeedPage() {
  const { activity, loaded } = useData();
  const [kind, setKind] = useState('all');
  const today = todayInFirmTz();

  const all = useMemo(
    () => Object.values(activity).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    [activity]
  );

  const counts = useMemo(() => {
    const out = { all: all.length };
    for (const k of KINDS) if (k.key !== 'all') out[k.key] = all.filter((a) => a.kind === k.key).length;
    return out;
  }, [all]);

  const filtered = kind === 'all' ? all : all.filter((a) => a.kind === kind);
  const pinned = filtered.filter((a) => a.pinned);
  const unpinned = filtered.filter((a) => !a.pinned);
  const todayRows = unpinned.filter((a) => String(a.createdAt).slice(0, 10) === today);
  const earlier = unpinned.filter((a) => String(a.createdAt).slice(0, 10) !== today);

  const rail = (
    <>
      {KINDS.map((k) => (
        <RailItem
          key={k.key}
          icon={k.icon}
          label={k.label}
          count={counts[k.key]}
          active={kind === k.key}
          onClick={() => setKind(k.key)}
        />
      ))}
    </>
  );

  return (
    <RailLayout title="Feed" count={filtered.length} rail={rail} wide>
      {/*
        A firm-wide note with no matter attached. Useful for practice-level
        reminders, and it means the Feed is not read-only -- previously the
        only way to add anything was to open a matter first.
      */}
      <ActivityComposer matterId={null} />

      {!loaded ? (
        <p className="text-sm text-ink-3">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="py-12 text-center text-sm text-ink-4">
          Nothing in the feed yet. Notes, calls and tasks added on a matter appear here.
        </p>
      ) : (
        <>
          <Group label="Pinned" rows={pinned} />
          <Group label="Today" rows={todayRows} />
          <Group label="Earlier" rows={earlier} />
        </>
      )}
    </RailLayout>
  );
}

function Group({ label, rows }) {
  if (rows.length === 0) return null;
  return (
    <section className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-ink-2">{label}</h3>
        <span className="text-xs text-ink-3">{rows.length} items</span>
      </div>
      {rows.map((a) => (
        <ActivityCard key={a.id} entry={a} />
      ))}
    </section>
  );
}
