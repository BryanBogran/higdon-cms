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
import { useRouter } from 'next/navigation';
import { SECTIONS, SECTION_BY_KEY, isSectionKey } from '@/lib/sections/registry';
import MatterHeader from '@/components/matter/MatterHeader';
import SectionRail from '@/components/matter/SectionRail';
import ActivitySection from '@/components/sections/ActivitySection';
import CaseInfoSection from '@/components/sections/CaseInfoSection';
import LitigationSection from '@/components/sections/LitigationSection';
import DeadlineChainSection from '@/components/sections/DeadlineChainSection';
import GenericSection from '@/components/sections/GenericSection';
import SettlementCalculatorSection from '@/components/sections/SettlementCalculatorSection';
import RelatedCasesSection from '@/components/sections/RelatedCasesSection';
import DocsSection from '@/components/sections/DocsSection';

const CUSTOM = {
  activity: ActivitySection,
  'settlement-calculator': SettlementCalculatorSection,
  'related-cases': RelatedCasesSection,
  docs: DocsSection,
  // Retired from the rail but still routable -- see `hidden` in the registry.
  'case-info': CaseInfoSection,
  litigation: LitigationSection,
  'deadline-chain': DeadlineChainSection,
};

export default function MatterSectionPage({ params }) {
  const { id, section } = use(params);
  const { matters, loaded } = useData();
  const router = useRouter();

  if (!isSectionKey(section)) notFound();

  const def = SECTION_BY_KEY[section];
  const matter = matters[id];

  if (!loaded) {
    return <p className="p-8 text-sm text-ink-3">Loading…</p>;
  }
  if (!matter) {
    return (
      <div className="p-8">
        <p className="text-sm text-ink-2">
          No matter with that id. It may have been deleted, or this link is stale.
        </p>
      </div>
    );
  }

  const Custom = CUSTOM[section];

  return (
    <div>
      <MatterHeader matterId={id} matter={matter} />
      {/*
        On a phone the rail was `hidden lg:block` with no replacement, so there
        was no way to reach any section at all. This select is the same
        registry, rendered for small screens.
      */}
      <div className="lg:hidden px-4 py-2 bg-surface border-b border-line">
        <select
          value={section}
          onChange={(e) => router.push(`/matters/${id}/${e.target.value}`)}
          className="input"
          aria-label="Matter section"
        >
          {SECTIONS.map((sec) => (
            <option key={sec.key} value={sec.key}>{sec.label}</option>
          ))}
        </select>
      </div>

      <div className="flex min-h-[calc(100vh-3.5rem-6.5rem)]">
        <aside className="w-56 shrink-0 border-r border-line bg-surface hidden lg:block">
          <SectionRail matterId={id} activeSection={section} />
        </aside>
        <main className="flex-1 min-w-0 p-4 sm:p-6">
          {Custom ? (
            <Custom matterId={id} matter={matter} />
          ) : (
            <GenericSection matterId={id} matter={matter} section={def} />
          )}
        </main>
      </div>
    </div>
  );
}
