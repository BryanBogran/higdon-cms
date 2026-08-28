'use client';

/**
 * The Filevine global bar. Deliberately close to the original: staff use it
 * every day, and the point of the clone is that nothing needs relearning.
 *
 * Dashboard is first and is the home route -- Filevine has no dashboard, but the
 * firm's requirements note asks for one by name. See docs/DECISIONS.md.
 */

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, CheckSquare, Zap, FolderOpen, Files, Menu } from 'lucide-react';
import GlobalSearch from './GlobalSearch';
import MainMenu from './MainMenu';
import SaveIndicator from './SaveIndicator';
import UserMenu from './UserMenu';

const NAV = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard, match: (p) => p === '/' },
  { href: '/tasks', label: 'Tasks', icon: CheckSquare, match: (p) => p.startsWith('/tasks') },
  { href: '/feed', label: 'Feed', icon: Zap, match: (p) => p.startsWith('/feed') },
  { href: '/projects', label: 'Project Hub', icon: FolderOpen, match: (p) => p.startsWith('/projects') || p.startsWith('/matters') },
  { href: '/documents', label: 'Documents', icon: Files, match: (p) => p.startsWith('/documents') },
];

export default function TopRail() {
  const pathname = usePathname() || '/';
  const [menuOpen, setMenuOpen] = useState(false);

  // The sign-in page is not part of the app shell -- showing nav to someone who
  // is not signed in advertises routes they cannot reach.
  if (pathname.startsWith('/login')) return null;

  return (
    <header className="sticky top-0 z-40 bg-slate-900 text-white">
      <div className="flex items-center gap-1 px-3 h-14">
        <button
          onClick={() => setMenuOpen(true)}
          aria-label="Main menu"
          aria-expanded={menuOpen}
          className="p-2 mr-1 rounded hover:bg-white/10 shrink-0"
        >
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

        {/*
          Filevine has three more icons here (new document, stacks, help). They
          were copied in as chrome and did nothing -- a button that looks live
          and isn't is worse than an absent one, so they are gone until the
          features behind them exist.
        */}
        <div className="flex items-center gap-1 shrink-0">
          <SaveIndicator />
          <UserMenu />
        </div>
      </div>
      <MainMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onSearch={() => document.getElementById('global-search')?.focus()}
      />
    </header>
  );
}
