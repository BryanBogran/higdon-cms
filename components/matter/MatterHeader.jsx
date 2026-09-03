'use client';

/**
 * The Filevine matter header: "Last, First YY-NNN", client name, click-to-call
 * phone, click-to-email, project type.
 *
 * Phone and email have no home in the prototype's FIELDS at all -- the schema
 * adds them (see docs/DECISIONS.md). Until the matter record carries them they
 * render as an "add" affordance rather than being hidden, so the gap is visible.
 *
 * The client name is <ClientCard>: a link to the contact card when one is
 * linked, and a way to link one when it is not. That second half is what makes
 * the phone and email below actually fill in -- a case imported from a
 * spreadsheet or made from a Drive folder has a client name and no client
 * record, so editing the contact was changing something this page did not
 * point at.
 */

import Link from 'next/link';
import { Phone, Mail, Archive } from 'lucide-react';
import { matterTitle, initials, avatarColor } from '@/lib/domain/matter';
import { FIELD_BY_KEY } from '@/lib/domain/fields';
import { useData } from '@/lib/data/DataProvider';
import { fmt } from '@/lib/domain/dates';
import MatterActions from './MatterActions';
import ClientCard from './ClientCard';

export default function MatterHeader({ matterId, matter }) {
  const { updateMatterField, contacts, sectionState } = useData();
  const v = matter?.values || {};

  /*
   * The strip's contents, in Filevine's order, because the firm reads the two
   * side by side. Dates go through `fmt` so they display the way every other
   * date in the app does rather than as an ISO string.
   *
   * Accident Type comes from the Intake section, not the matter row -- see the
   * note on the strip below.
   */
  /*
   * Via `sectionState`, not by reaching into `sections` directly: the shape is
   * { fields, rows } per section, and an earlier version of this line read
   * `sections[matterId].intake.accidenttype` -- one level short of `.fields`,
   * which would have rendered an em dash forever and looked like missing data
   * rather than a wrong path.
   */
  const accidentType = sectionState(matterId, 'intake').fields?.accidenttype || '';

  const strip = [
    { label: 'Referral', value: v.referral, tab: 'case-info' },
    { label: 'Primary Attorney', value: v.attorney, tab: 'case-info' },
    // Filevine's name for the same field we call DOA.
    { label: 'Incident Date', value: fmt(v.doa), tab: 'case-info' },
    { label: 'Driver Insurance', value: v.insurance, tab: 'case-info' },
    { label: 'Driver Policy Limits', value: v.policyLimits, tab: 'case-info' },
    { label: 'Trial Date', value: fmt(v.trialDate), tab: 'case-info' },
    { label: 'Cause No.', value: v.causeNumber, tab: 'case-info' },
    { label: 'County', value: v.county, tab: 'case-info' },
    { label: 'Court Room', value: v.courtRoom, tab: 'case-info' },
    { label: 'SOL', value: fmt(v.sol), tab: 'case-info' },
    // The one that is edited somewhere else -- and the only way anyone would
    // know that is this link going to a different tab from its neighbours.
    { label: 'Accident Type', value: accidentType, tab: 'intake' },
  ];


  /*
   * Prefer the linked contact. Entering a phone number on the client's record
   * and then reading "no phone on file" on their case is the exact failure
   * contacts exist to end -- the record is only one record if the places
   * people look actually read it.
   *
   * The matter's own columns remain the fallback, because every case imported
   * or created before contacts existed has those and no contact.
   */
  const contact = matter?.clientContactId ? contacts?.[matter.clientContactId] : null;
  const phone = contact?.phones?.[0]?.value || v.clientPhone || '';
  const email = contact?.emails?.[0]?.value || v.clientEmail || '';

  return (
    <div className="bg-surface border-b border-line">
      {matter?.archivedAt ? (
        <div className="flex items-center gap-2 px-5 py-2 bg-warn-bg border-b border-warn-line text-sm text-warn-ink-strong">
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
          <h1 className="text-2xl font-bold text-accent-ink truncate">{matterTitle(matter)}</h1>

          <div className="flex items-center gap-5 mt-1.5 flex-wrap text-sm">
            <ClientCard matterId={matterId} matter={matter} />

            {phone ? (
              <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} className="flex items-center gap-1.5 text-accent-ink hover:underline">
                <Phone size={15} /> {phone}
              </a>
            ) : (
              <span className="flex items-center gap-1.5 text-ink-4">
                <Phone size={15} /> no phone on file
              </span>
            )}

            {email ? (
              <a href={`mailto:${email}`} className="flex items-center gap-1.5 text-accent-ink hover:underline">
                <Mail size={15} /> {email}
              </a>
            ) : (
              <span className="flex items-center gap-1.5 text-ink-4">
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
            className="border border-line-strong rounded px-3 py-2 text-sm text-ink-2 bg-surface"
            title="Coverage type"
          >
            <option value="">Coverage — not set</option>
            {(FIELD_BY_KEY.commercial.options || []).map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          <Link
            href={`/matters/${matterId}/case-info`}
            className="px-3 py-2 rounded bg-accent-solid text-white text-sm font-semibold hover:bg-accent-solid-2"
          >
            Case Info
          </Link>
          <MatterActions matterId={matterId} matter={matter} />
        </div>
      </div>

      {/*
        ── THE FILEVINE FIELD STRIP ──────────────────────────────────────────

        The firm sent a photo of Filevine's matter header and asked for it
        replicated: a horizontal run of labelled values under the client name,
        in this order.

        READ-ONLY. Each HEADING links to the tab where that field is edited --
        Case Info for ten of them, Intake for Accident Type.

        Not editable here, and that is deliberate: FieldInput already carries
        the high-stakes date warnings ("falls on a Martin Luther King Jr. Day"),
        and SOL is the field the whole deadline engine exists to protect. A
        second editor in the header that skipped those checks would be a worse
        place to type a statute of limitations than the form is.

        An empty field renders an em dash rather than disappearing. A strip that
        reflows depending on which values happen to be filled in is unreadable
        at a glance, and "no cause number yet" is information.

        Accident Type is the odd one: it lives in the Intake SECTION rather than
        on the matter row, so it is read from `sections`. One field, one home --
        giving it a second on `matter` to make this strip tidier would create
        two values that can disagree.
      */}
      <dl className="px-5 pb-3 flex flex-wrap gap-x-6 gap-y-2 border-t border-line-soft pt-3">
        {strip.map(({ label, value, tab }) => (
          <div key={label} className="min-w-0">
            {/*
              THE HEADING IS THE LINK, not the value.
              A value can be empty, and an em dash is a poor thing to aim at --
              which is precisely when someone wants to go and fill it in. The
              label is always there and always the same size, so the click
              target does not move about.
            */}
            <dt className="text-[10px] font-bold uppercase tracking-wide">
              <Link
                href={`/matters/${matterId}/${tab}`}
                className="text-ink-3 hover:text-accent-ink hover:underline underline-offset-2"
                title={`Edit ${label} on ${tab === 'intake' ? 'Intake' : 'Case Info'}`}
              >
                {label}
              </Link>
            </dt>
            <dd className="text-sm text-ink-2 truncate max-w-[16rem]">
              {value || <span className="text-ink-4">—</span>}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
