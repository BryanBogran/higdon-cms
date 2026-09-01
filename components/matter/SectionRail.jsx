'use client';

/**
 * The matter section rail -- the heart of the Filevine layout.
 *
 * Driven entirely by lib/sections/registry.js, so adding the fifteenth section
 * is a registry entry, not a component. All fourteen show from day one; the ones
 * nobody has purpose-built yet fall through to the generic engine.
 */

import Link from 'next/link';
import * as Icons from 'lucide-react';
// RAIL_SECTIONS, not SECTIONS: the rail is the firm's own ordered list, and
// retired sections stay routable without appearing here.
import { RAIL_SECTIONS } from '@/lib/sections/registry';

export default function SectionRail({ matterId, activeSection }) {
  return (
    <nav className="py-2" aria-label="Matter sections">
      {RAIL_SECTIONS.map((s) => {
        const Icon = Icons[s.icon] || Icons.Circle;
        const active = s.key === activeSection;
        return (
          <Link
            key={s.key}
            href={`/matters/${matterId}/${s.key}`}
            className={`flex items-center gap-2.5 px-5 py-2 text-sm transition ${
              active
                ? 'bg-accent-bg text-accent-ink-strong font-semibold border-l-[3px] border-accent-solid pl-[17px]'
                : 'text-ink-2 hover:bg-hover border-l-[3px] border-transparent pl-[17px]'
            }`}
          >
            <Icon size={17} className={active ? 'text-accent-ink' : 'text-ink-4'} />
            <span className="truncate">{s.label}</span>
            {s.kind === 'generic' && !s.verified ? (
              <span
                title="Fields not yet confirmed against Filevine"
                className="ml-auto w-1.5 h-1.5 rounded-full bg-warn-solid-2"
              />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
