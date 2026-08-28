'use client';

/**
 * Browser Supabase client.
 *
 * The publishable/anon key is public by design. What keeps the database
 * private is Row Level Security -- see supabase/schema.sql. If RLS were off,
 * this key would be a public read of every case.
 */

import { createBrowserClient } from '@supabase/ssr';

let cached = null;

export function getSupabaseBrowserClient() {
  if (cached) return cached;
  cached = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
  return cached;
}

/** True when the environment is configured. Lets the app fall back to localStorage. */
export function isSupabaseConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
}
