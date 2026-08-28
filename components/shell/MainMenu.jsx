'use client';

/**
 * The hamburger drawer, in Filevine's order.
 *
 * The order is theirs, not ours, and it is copied exactly. Staff build muscle
 * memory for menu positions faster than for anything else on a screen, and the
 * whole reason for cloning the layout is that nobody should have to relearn it.
 *
 * ── Why unbuilt items are SHOWN, greyed, rather than omitted ──────────────
 * The rule elsewhere in this app is that a control which looks live and isn't
 * is worse than an absent one -- three chrome icons were deleted from TopRail
 * for exactly that reason. This menu is the one place that rule does not
 * apply, because the risk here is the opposite one.
 *
 * A staff member who opens this menu on day one is checking whether the thing
 * they use every day still exists. If Mailroom is simply missing they conclude
 * it is gone and go back to asking someone to forward them mail. If it is
 * listed and says "not built yet", they know it is coming and say so out loud
 * -- which is the feedback this project needs.
 *
 * So: disabled, visibly grey, cursor-not-allowed, with a plain-English note.
 * Not clickable, not a fake. The gap is the message.
 */

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  X, Inbox, Contact, Calendar, Search, Plus, ListChecks,
  FilePlus2, Settings, LayoutGrid,
} from 'lucide-react';

/**
 * `href` means it works. `soon` means it does not exist yet and says so.
 *
 * Never give an item both: a link that goes to a placeholder page is exactly
 * the dead control this file is trying to avoid.
 */
const ITEMS = [
  {
    key: 'mailroom', label: 'Mailroom', icon: Inbox,
    soon: 'Firm-wide inbox for mail that arrives without a case address. The parser and webhook it needs are already built — this is the queue on top of them.',
  },
  {
    key: 'contacts', label: 'Contacts', icon: Contact,
    soon: 'One card per client, provider, adjuster and expert, reused across matters. Today parties are free text on each matter.',
  },
  {
    key: 'calendar', label: 'Calendar', icon: Calendar,
    soon: 'Month view of deadlines and events, with Google/Outlook sync. The dates already exist — see the Tasks list.',
  },
  { key: 'search', label: 'Search', icon: Search, action: 'search' },
  { key: 'new-project', label: 'New Project', icon: Plus, href: '/projects/new', accent: true },
  {
    key: 'saved-reports', label: 'Saved Reports', icon: ListChecks,
    soon: 'Saved, shareable report definitions. Needs Report Builder first.',
  },
  {
    key: 'report-builder', label: 'Report Builder', icon: FilePlus2,
    soon: 'Pick fields, filter, group, export. The largest unbuilt piece — see docs/ROADMAP.md.',
  },
  {
    key: 'setup', label: 'Setup', icon: Settings,
    soon: 'Org settings: staff accounts, roles, teams. Accounts are created by hand in Supabase today.',
  },
  {
    key: 'advanced', label: 'Advanced', icon: LayoutGrid,
    soon: 'Filevine’s Customs Editor — designing project types and their sections. Ours are defined in lib/sections/registry.js.',
  },
];

export default function MainMenu({ open, onClose, onSearch }) {
  const pathname = usePathname();

  // Escape closes, and the route changing closes. Without the second, tapping
  // New Project leaves the drawer sitting over the page you just opened.
  useEffect(() => { onClose(); }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    // The page behind must not scroll while a full-height drawer is over it.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose} aria-hidden />

      <nav
        aria-label="Main menu"
        className="fixed inset-y-0 left-0 z-50 w-[19rem] max-w-[85vw] bg-slate-900 text-white overflow-y-auto"
      >
        <div className="flex items-center gap-4 h-14 px-4">
          <button onClick={onClose} aria-label="Close menu" className="p-1 hover:bg-white/10 rounded">
            <X size={22} />
          </button>
          <span className="font-bold tracking-tight">HIGDON LAWYERS</span>
        </div>

        <ul className="py-2">
          {ITEMS.map((item) => {
            const Icon = item.icon;
            const inner = (
              <>
                <Icon size={20} className="shrink-0" />
                <span className="flex-1 text-[15px] font-medium">{item.label}</span>
              </>
            );

            if (item.href) {
              return (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    className={`flex items-center gap-4 px-4 py-3.5 ${
                      item.accent ? 'bg-teal-600 hover:bg-teal-500' : 'hover:bg-white/10'
                    }`}
                  >
                    {inner}
                  </Link>
                </li>
              );
            }

            if (item.action === 'search') {
              return (
                <li key={item.key}>
                  <button
                    onClick={() => { onClose(); onSearch?.(); }}
                    className="w-full flex items-center gap-4 px-4 py-3.5 text-left hover:bg-white/10"
                  >
                    {inner}
                  </button>
                </li>
              );
            }

            return (
              <li key={item.key}>
                <div
                  aria-disabled="true"
                  title={item.soon}
                  className="flex items-center gap-4 px-4 py-3.5 text-slate-500 cursor-not-allowed"
                >
                  {inner}
                  <span className="text-[10px] uppercase tracking-wide border border-slate-600 rounded px-1.5 py-0.5">
                    Not built
                  </span>
                </div>
                <p className="px-4 pb-3 -mt-1 ml-9 text-xs text-slate-500 leading-snug">{item.soon}</p>
              </li>
            );
          })}
        </ul>

        <p className="px-4 py-4 text-xs text-slate-500 border-t border-white/10">
          Greyed items are Filevine features this system does not have yet. They are listed so
          nothing looks quietly missing — tell Bryan which ones you actually use and they get
          built first.
        </p>
      </nav>
    </>
  );
}
