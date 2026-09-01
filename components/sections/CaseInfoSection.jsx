'use client';

/** The matter record, grouped by the FIELDS registry's own sections. */

import FieldInput from './FieldInput';
import { FIELDS } from '@/lib/domain/fields';
import { useData } from '@/lib/data/DataProvider';

const GROUPS = ['Case Info', 'Financial'];

export default function CaseInfoSection({ matterId, matter }) {
  const { updateMatterField } = useData();
  const values = matter?.values || {};

  return (
    <div className="space-y-6">
      {GROUPS.map((group) => {
        const fields = FIELDS.filter((f) => f.section === group && f.type !== 'yesnoDoc');
        if (fields.length === 0) return null;
        return (
          <div key={group} className="bg-surface rounded-xl border border-line shadow-sm">
            <div className="px-5 py-3 border-b border-line-soft">
              <h2 className="font-semibold text-ink">{group}</h2>
            </div>
            <div className="p-5 grid gap-4 sm:grid-cols-2">
              {fields.map((f) => (
                <div key={f.key} className={f.type === 'textarea' ? 'sm:col-span-2' : ''}>
                  <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-4 mb-1">
                    {f.label}
                    {f.highStakes ? <span className="ml-1 text-warn-ink" title="Confirm with attorney">•</span> : null}
                  </label>
                  <FieldInput
                    field={f}
                    value={values[f.key]}
                    onChange={(val) => updateMatterField(matterId, f.key, val)}
                  />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
