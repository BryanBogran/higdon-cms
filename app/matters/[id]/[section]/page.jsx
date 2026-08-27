'use client';

/**
 * The matter shell: header + section rail + section content.
 *
 * URL is /matters/{id}/{section}, so every section is deep-linkable and the back
 * button works. The prototype had no router at all -- view was useState, which
 * meant no shareable links to a matter.
 */

import { use } from 'react';
import { notFound } from 'next/navigation';
import { useData } from '@/lib/data/DataProvider';
import { SECTION_BY_KEY, isSectionKey } from '@/lib/sections/registry';
import MatterHeader from '@/components/matter/MatterHeader';
import SectionRail from '@/components/matter/SectionRail';
import ActivitySection from '@/components/sections/ActivitySection';
import CaseInfoSection from '@/components/sections/CaseInfoSection';
import LitigationSection from '@/components/sections/LitigationSection';
import DeadlineChainSection from '@/components/sections/DeadlineChainSection';
import GenericSection from '@/components/sections/GenericSection';

const CUSTOM = {
  activity: ActivitySection,
  'case-info': CaseInfoSection,
  litigation: LitigationSection,
  'deadline-chain': DeadlineChainSection,
};

export default function MatterSectionPage({ params }) {
  const { id, section } = use(params);
  const { matters, loaded } = useData();

  if (!isSectionKey(section)) notFound();

  const def = SECTION_BY_KEY[section];
  const matter = matters[id];

  if (!loaded) {
    return <p className="p-8 text-sm text-slate-500">Loading…</p>;
  }
  if (!matter) {
    return (
      <div className="p-8">
        <p className="text-sm text-slate-600">
          No matter with that id. It may have been deleted, or this link is stale.
        </p>
      </div>
    );
  }

  const Custom = CUSTOM[section];

  return (
    <div>
      <MatterHeader matterId={id} matter={matter} />
      <div className="flex min-h-[calc(100vh-3.5rem-6.5rem)]">
        <aside className="w-56 shrink-0 border-r border-slate-200 bg-white hidden lg:block">
          <SectionRail matterId={id} activeSection={section} />
        </aside>
        <main className="flex-1 min-w-0 p-4 sm:p-6">
          <h2 className="text-lg font-bold text-slate-900 mb-4 lg:hidden">{def.label}</h2>
          {Custom ? (
            <Custom matterId={id} matter={matter} />
          ) : (
            <GenericSection matterId={id} section={def} />
          )}
        </main>
      </div>
    </div>
  );
}
