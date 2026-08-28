'use client';

/**
 * Who you are, and how to leave.
 *
 * Both were missing entirely: there was no sign-out anywhere in the app, and
 * no indication of which account you were using. On a system holding
 * privileged client files, "log out" is not a nicety — a shared or borrowed
 * machine has no other way to end the session.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, ChevronDown, Loader2 } from 'lucide-react';
import { useData } from '@/lib/data/DataProvider';
import { getSupabaseBrowserClient, isSupabaseConfigured } from '@/lib/supabase/client';

export default function UserMenu() {
  const { currentUser, backend } = useData();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    function onDocClick(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    function onEsc(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, []);

  async function signOut() {
    setBusy(true);
    try {
      if (isSupabaseConfigured()) {
        await getSupabaseBrowserClient().auth.signOut();
      }
      router.push('/login');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const initial = (currentUser?.displayName || currentUser?.email || '?')
    .trim()
    .charAt(0)
    .toUpperCase();

  return (
    <div ref={boxRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 pl-1 pr-1.5 py-1 rounded hover:bg-white/10"
        title={currentUser?.email || 'Account'}
      >
        <span className="w-8 h-8 rounded-full bg-orange-500 grid place-items-center text-sm font-semibold">
          {initial}
        </span>
        <ChevronDown size={14} className="text-slate-300" />
      </button>

      {open ? (
        <div className="absolute right-0 mt-1.5 w-64 bg-white rounded-lg shadow-xl border border-slate-200 overflow-hidden z-50 text-slate-900">
          <div className="px-4 py-3 border-b border-slate-100">
            <p className="font-semibold text-sm truncate">
              {currentUser?.displayName || 'Not signed in'}
            </p>
            {currentUser?.email ? (
              <p className="text-xs text-slate-500 truncate">{currentUser.email}</p>
            ) : null}
            {currentUser?.handle ? (
              <p className="text-xs text-slate-400 mt-0.5">
                @{currentUser.handle} · {currentUser.role}
              </p>
            ) : null}
          </div>

          {backend !== 'supabase' ? (
            <p className="px-4 py-2 text-xs text-amber-700 bg-amber-50 border-b border-amber-100">
              Running on browser storage — this data is on this device only.
            </p>
          ) : null}

          <button
            onClick={signOut}
            disabled={busy}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-left hover:bg-slate-50 disabled:opacity-50"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <LogOut size={15} />}
            {busy ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
