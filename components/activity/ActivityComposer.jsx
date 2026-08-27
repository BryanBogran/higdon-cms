'use client';

/** The "Add new activity…" composer. */

import { useState } from 'react';
import { useData } from '@/lib/data/DataProvider';

const KINDS = ['note', 'call', 'text', 'email', 'task'];

export default function ActivityComposer({ matterId }) {
  const { addActivity } = useData();
  const [body, setBody] = useState('');
  const [kind, setKind] = useState('note');
  const [open, setOpen] = useState(false);

  function submit() {
    const text = body.trim();
    if (!text) return;
    const mentions = [...text.matchAll(/@([A-Za-z0-9_.-]+)/g)].map((m) => m[1]);
    addActivity({ matterId, kind, body: text, mentions, author: 'You' });
    setBody('');
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full text-left px-4 py-3 mb-4 rounded-lg border border-slate-200 bg-white text-slate-400 hover:border-slate-300"
      >
        Add new activity…
      </button>
    );
  }

  return (
    <div className="mb-4 rounded-lg border border-slate-300 bg-white shadow-sm">
      <textarea
        autoFocus
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
          if (e.key === 'Escape') setOpen(false);
        }}
        placeholder="Type a note. Use @name to mention someone."
        className="w-full px-4 py-3 text-sm outline-none resize-y min-h-[84px] rounded-t-lg"
      />
      <div className="px-3 py-2 border-t border-slate-100 flex items-center gap-2">
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="input w-auto text-sm">
          {KINDS.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
        <span className="text-xs text-slate-400 hidden sm:inline">⌘↵ to save</span>
        <div className="flex-1" />
        <button onClick={() => setOpen(false)} className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900">
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={!body.trim()}
          className="px-4 py-1.5 rounded bg-slate-900 text-white text-sm font-semibold disabled:opacity-40 hover:bg-slate-800"
        >
          Save
        </button>
      </div>
    </div>
  );
}
