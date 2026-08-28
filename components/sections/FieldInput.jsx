'use client';

/** One control, driven by a field definition. Shared by every section. */

import { checkBadDate, fmt } from '@/lib/domain/dates';
import { AlertTriangle, ExternalLink, User, Paperclip, Check } from 'lucide-react';

export default function FieldInput({ field, value, onChange, row }) {
  const v = value ?? '';

  /**
   * Derived, never typed into. Filevine ships two of these:
   * Liens "Reduced By = Amount - Reduction" and Meds
   * "Reduced By = Amount - Write Offs/Adjustments".
   */
  if (field.type === 'calculated') {
    const num = (x) => {
      const n = parseFloat(String(x ?? '').replace(/[^0-9.-]/g, ''));
      return Number.isFinite(n) ? n : 0;
    };
    const [a, b] = field.inputs || [];
    const result = num(row?.[a]) - num(row?.[b]);
    return (
      <div
        className="input bg-slate-50 text-slate-600 cursor-not-allowed"
        title={`Calculated: ${a} − ${b}`}
      >
        {result.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
      </div>
    );
  }

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

  /**
   * A LINKED PERSON, not a string.
   *
   * Filevine resolves provider / payee / insurer / driver / party to one shared
   * contact record. We don't have that entity yet, so this stores a name and
   * flags itself — when Parties becomes a real table this becomes a picker and
   * the stored text becomes the fallback display name. Storing a string now
   * means nothing has to be re-entered later.
   */
  if (field.type === 'contact') {
    return (
      <div className="relative">
        <User size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          className="input pl-8"
          placeholder="Name"
          title="Will become a contact picker once Parties is a real entity"
          value={typeof v === 'object' ? v?.fullname || '' : v}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }

  /** `{ dateValue, doneDate }` — a deadline with a completion stamp. */
  if (field.type === 'datedone') {
    const val = typeof v === 'object' && v ? v : { dateValue: '', doneDate: '' };
    const done = Boolean(val.doneDate);
    return (
      <div className="flex items-center gap-1.5">
        <input
          type="date"
          className="input"
          value={val.dateValue || ''}
          onChange={(e) => onChange({ ...val, dateValue: e.target.value })}
        />
        <button
          type="button"
          onClick={() =>
            onChange({ ...val, doneDate: done ? '' : new Date().toISOString().slice(0, 10) })
          }
          title={done ? `Done ${val.doneDate}` : 'Mark done'}
          className={`shrink-0 px-2 py-2 rounded-lg border ${
            done
              ? 'bg-teal-50 border-teal-200 text-teal-700'
              : 'border-slate-200 text-slate-300 hover:text-slate-500'
          }`}
        >
          <Check size={15} />
        </button>
      </div>
    );
  }

  /** Documents hanging off one ROW, not the matter. Drive links for now. */
  if (field.type === 'attachments') {
    const list = Array.isArray(v) ? v : [];
    return (
      <div>
        {list.map((a, i) => (
          <a
            key={i}
            href={a?.url || '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-teal-700 hover:underline mb-0.5"
          >
            <Paperclip size={11} /> {a?.name || 'Document'}
          </a>
        ))}
        <input
          type="url"
          className="input"
          placeholder="Add a Drive link"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.currentTarget.value.trim()) {
              onChange([...list, { name: 'Document', url: e.currentTarget.value.trim() }]);
              e.currentTarget.value = '';
            }
          }}
        />
      </div>
    );
  }

  /** Multi-select, stored as an array. */
  if (field.type === 'multiselect') {
    const list = Array.isArray(v) ? v : v ? [v] : [];
    return (
      <div className="flex flex-wrap gap-1.5">
        {(field.options || []).map((o) => {
          const on = list.includes(o);
          return (
            <button
              key={o}
              type="button"
              onClick={() => onChange(on ? list.filter((x) => x !== o) : [...list, o])}
              className={`px-2 py-1 rounded-full text-xs border ${
                on
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-300 hover:border-slate-400'
              }`}
            >
              {o}
            </button>
          );
        })}
      </div>
    );
  }

  const type = field.type === 'tel' ? 'tel' : field.type === 'email' ? 'email' : 'text';
  return <input type={type} className="input" value={v} onChange={(e) => onChange(e.target.value)} />;
}

export { fmt };
