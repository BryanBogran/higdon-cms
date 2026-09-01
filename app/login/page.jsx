'use client';

/**
 * Sign in.
 *
 * Email and password, no self-signup. Accounts are created by hand in the
 * Supabase dashboard — a five-person firm doesn't need a signup flow, and
 * every signup flow is attack surface.
 */

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Logo from '@/components/shell/Logo';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { getSupabaseBrowserClient, isSupabaseConfigured } from '@/lib/supabase/client';

/**
 * useSearchParams() opts a component out of prerendering, so it lives behind a
 * Suspense boundary and the page shell stays static.
 */
function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const configured = isSupabaseConfigured();

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) {
        setError(signInError.message);
        setBusy(false);
        return;
      }
      const next = params.get('next') || '/';
      router.push(next);
      router.refresh();
    } catch (err) {
      setError(err?.message || 'Could not sign in.');
      setBusy(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
        {/*
          The logo is white lettering, and this page is white. Dropped straight
          on it, it would be an invisible rectangle above the sign-in box --
          so it sits on the same slate-900 the top bar uses. Reads as a
          deliberate mark rather than as artwork that failed to load, and it
          means one file serves all three places instead of needing a second
          dark-on-light version the firm may not have.
        */}
        <div className="flex justify-center mb-6">
          <span className="rounded-xl bg-chrome px-6 py-4">
            <Logo width={160} />
          </span>
        </div>

        <form onSubmit={submit} className="bg-surface rounded-xl border border-line shadow-sm p-6">
          <h1 className="text-lg font-semibold text-ink mb-1">Sign in</h1>
          <p className="text-sm text-ink-3 mb-5">Case management system.</p>

          {!configured ? (
            <div className="mb-4 rounded-lg border border-warn-line bg-warn-bg p-3 text-sm text-warn-ink-strong">
              <p className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle size={15} /> Supabase isn&apos;t configured
              </p>
              <p className="mt-1 text-xs">
                Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
                <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> to{' '}
                <code>.env.local</code>, then restart the dev server. The app runs on browser
                storage until then.
              </p>
            </div>
          ) : null}

          <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-4 mb-1">
            Email
          </label>
          <input
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input mb-4"
            placeholder="you@higdonlawyers.com"
          />

          <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-4 mb-1">
            Password
          </label>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input mb-4"
          />

          {error ? (
            <p className="flex items-start gap-1.5 mb-4 text-sm text-danger-ink">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={busy || !configured}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary text-white font-semibold hover:bg-primary-2 disabled:opacity-40"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : null}
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <p className="mt-4 text-xs text-ink-4 text-center">
            Accounts are created by an administrator. There is no self-signup.
          </p>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen grid place-items-center bg-canvas p-4">
      <Suspense fallback={<p className="text-sm text-ink-3">Loading…</p>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
