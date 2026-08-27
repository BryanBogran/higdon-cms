'use client';

/**
 * The Filevine global bar. Deliberately close to the original: staff use it
 * every day, and the point of the clone is that nothing needs relearning.
 *
 * Dashboard is first and is the home route -- Filevine has no dashboard, but the
 * firm's requirements note asks for one by name. See docs/DECISIONS.md.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, CheckSquare, Zap, FolderOpen, Files,
  Menu, HelpCircle, Layers, FilePlus2,
} from 'lucide-react';
import GlobalSearch from './GlobalSearch';
import SaveIndicator from './SaveIndicator';

const NAV = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard, match: (p) => p === '/' },
  { href: '/tasks', label: 'Tasks', icon: CheckSquare, match: (p) => p.startsWith('/tasks') },
  { href: '/feed', label: 'Feed', icon: Zap, match: (p) => p.startsWith('/feed') },
  { href: '/projects', label: 'Project Hub', icon: FolderOpen, match: (p) => p.startsWith('/projects') || p.startsWith('/matters') },
  { href: '/documents', label: 'Documents', icon: Files, match: (p) => p.startsWith('/documents') },
];

export default function TopRail() {
  const pathname = usePathname() || '/';

  return (
    <header className="sticky top-0 z-40 bg-slate-900 text-white">
      <div className="flex items-center gap-1 px-3 h-14">
        <button className="p-2 rounded hover:bg-white/10 shrink-0" aria-label="Menu">
          <Menu size={20} />
        </button>

        <nav className="flex items-center gap-1 shrink-0">
          {NAV.map(({ href, label, icon: Icon, match }) => {
            const active = match(pathname);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2 px-3 py-2 rounded text-sm font-medium transition ${
                  active ? 'bg-teal-600 text-white' : 'text-slate-200 hover:bg-white/10'
                }`}
              >
                <Icon size={17} />
                <span className="hidden md:inline">{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="flex-1 flex items-center justify-center min-w-0 px-4">
          <span className="hidden xl:block font-bold tracking-tight text-sm mr-4 shrink-0">
            HIGDON LAWYERS
          </span>
          <GlobalSearch />
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <SaveIndicator />
          <button className="p-2 rounded hover:bg-white/10 hidden sm:block" aria-label="New document">
            <FilePlus2 size={19} />
          </button>
          <button className="p-2 rounded hover:bg-white/10 hidden sm:block text-orange-400" aria-label="Stacks">
            <Layers size={19} />
          </button>
          <button className="p-2 rounded hover:bg-white/10 hidden sm:block" aria-label="Help">
            <HelpCircle size={19} />
          </button>
          <div className="w-8 h-8 rounded-full bg-orange-500 grid place-items-center text-sm font-semibold ml-1">
            H
          </div>
        </div>
      </div>
    </header>
  );
}
