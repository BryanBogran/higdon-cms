'use client';

/** One control, driven by a field definition. Shared by every section. */

import { checkBadDate, fmt } from '@/lib/domain/dates';
import { AlertTriangle, ExternalLink } from 'lucide-react';

export default function FieldInput({ field, value, onChange }) {
  const v = value ?? '';

  if (field.type === 'select') {
    return (
      <select className="input" value={v} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {(field.options || []).map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    );
  }

  if (field.type === 'textarea') {
    return (
      <textarea className="input min-h-[76px]" value={v} onChange={(e) => onChange(e.target.value)} />
    );
  }

  if (field.type === 'date') {
    const bad = checkBadDate(v);
    return (
      <div>
        <input type="date" className="input" value={v} onChange={(e) => onChange(e.target.value)} />
        {bad ? (
          <p className="flex items-center gap-1 mt-1 text-[11px] text-amber-700">
            <AlertTriangle size={12} /> Falls on a {bad}
          </p>
        ) : null}
      </div>
    );
  }

  if (field.type === 'url') {
    return (
      <div className="flex gap-1.5">
        <input
          type="url"
          className="input"
          placeholder="Google Drive link"
          value={v}
          onChange={(e) => onChange(e.target.value)}
        />
        {v ? (
          <a
            href={v}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 px-2.5 grid place-items-center border border-slate-200 rounded-lg text-teal-700 hover:bg-slate-50"
            title="Open document"
          >
            <ExternalLink size={15} />
          </a>
        ) : null}
      </div>
    );
  }

  if (field.type === 'money') {
    return (
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
        <input
          type="text"
          inputMode="decimal"
          className="input pl-6"
          value={v}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }

  const type = field.type === 'tel' ? 'tel' : field.type === 'email' ? 'email' : 'text';
  return <input type={type} className="input" value={v} onChange={(e) => onChange(e.target.value)} />;
}

export { fmt };
