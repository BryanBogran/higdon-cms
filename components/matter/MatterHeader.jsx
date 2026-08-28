'use client';

/**
 * The Filevine matter header: "Last, First YY-NNN", client name, click-to-call
 * phone, click-to-email, project type.
 *
 * Phone and email have no home in the prototype's FIELDS at all -- the schema
 * adds them (see docs/DECISIONS.md). Until the matter record carries them they
 * render as an "add" affordance rather than being hidden, so the gap is visible.
 */

import Link from 'next/link';
import { Phone, Mail, IdCard, Archive } from 'lucide-react';
import { matterTitle, initials, avatarColor } from '@/lib/domain/matter';
import { FIELD_BY_KEY } from '@/lib/domain/fields';
import { useData } from '@/lib/data/DataProvider';
import MatterActions from './MatterActions';

export default function MatterHeader({ matterId, matter }) {
  const { updateMatterField } = useData();
  const v = matter?.values || {};
  const phone = v.clientPhone || '';
  const email = v.clientEmail || '';

  return (
    <div className="bg-white border-b border-slate-200">
      {matter?.archivedAt ? (
        <div className="flex items-center gap-2 px-5 py-2 bg-amber-50 border-b border-amber-200 text-sm text-amber-800">
          <Archive size={15} />
          This matter is archived — it does not appear in the case list, task list or dashboard.
        </div>
      ) : null}
      <div className="px-5 py-4 flex items-start gap-4 flex-wrap">
        <div
          className={`w-14 h-14 rounded-full ${avatarColor(matterId)} grid place-items-center text-white text-lg font-bold shrink-0`}
        >
          {initials(matter)}
        </div>

        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-teal-700 truncate">{matterTitle(matter)}</h1>

          <div className="flex items-center gap-5 mt-1.5 flex-wrap text-sm">
            <span className="flex items-center gap-1.5 text-slate-700">
              <IdCard size={15} className="text-slate-400" />
              {v.clientName || '—'}
            </span>

            {phone ? (
              <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} className="flex items-center gap-1.5 text-teal-700 hover:underline">
                <Phone size={15} /> {phone}
              </a>
            ) : (
              <span className="flex items-center gap-1.5 text-slate-400">
                <Phone size={15} /> no phone on file
              </span>
            )}

            {email ? (
              <a href={`mailto:${email}`} className="flex items-center gap-1.5 text-teal-700 hover:underline">
                <Mail size={15} /> {email}
              </a>
            ) : (
              <span className="flex items-center gap-1.5 text-slate-400">
                <Mail size={15} /> no email on file
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Was a static div styled to look like a select. Now it is one. */}
          <select
            value={v.commercial || ''}
            onChange={(e) => updateMatterField(matterId, 'commercial', e.target.value)}
            className="border border-slate-300 rounded px-3 py-2 text-sm text-slate-700 bg-white"
            title="Coverage type"
          >
            <option value="">Coverage — not set</option>
            {(FIELD_BY_KEY.commercial.options || []).map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          <Link
            href={`/matters/${matterId}/case-info`}
            className="px-3 py-2 rounded bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700"
          >
            Case Info
          </Link>
          <MatterActions matterId={matterId} matter={matter} />
        </div>
      </div>
    </div>
  );
}
