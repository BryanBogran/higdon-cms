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
                ? 'bg-teal-50 text-teal-800 font-semibold border-l-[3px] border-teal-600 pl-[17px]'
                : 'text-slate-700 hover:bg-slate-50 border-l-[3px] border-transparent pl-[17px]'
            }`}
          >
            <Icon size={17} className={active ? 'text-teal-700' : 'text-slate-400'} />
            <span className="truncate">{s.label}</span>
            {s.kind === 'generic' && !s.verified ? (
              <span
                title="Fields not yet confirmed against Filevine"
                className="ml-auto w-1.5 h-1.5 rounded-full bg-amber-400"
              />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
