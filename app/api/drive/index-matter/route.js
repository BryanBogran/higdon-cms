/**
 * Index ONE matter's Drive folder.
 *
 * Called by the Docs tab when it opens, so indexing is something that just
 * happens rather than a button somebody has to remember. The tab renders its
 * cached rows immediately and calls this in the background — stale-while-
 * revalidate — because a Drive round-trip is a second or two and nobody should
 * watch a spinner to see documents that are already known.
 *
 * TWO THINGS KEEP THIS FROM HAMMERING DRIVE:
 *
 *   1. A staleness window. A matter indexed within FRESH_MINUTES is skipped
 *      outright. Without it, clicking between Docs and Activity a few times
 *      would fire a full folder walk each way.
 *   2. It is one matter, not a sweep. Cost is proportional to what someone is
 *      actually looking at.
 *
 * The gap this leaves, stated plainly: a case nobody opens never refreshes, so
 * the firm-wide Documents page can lag behind Drive. The proper fix for that is
 * Drive's `changes` API, which returns everything that changed since a token in
 * one cheap call rather than walking every folder. Recorded in DECISIONS.md as
 * the follow-up; this endpoint is not it.
 */

import { NextResponse } from 'next/server';
import {
  getSupabaseServerClient, getCurrentUser, isServerSupabaseConfigured,
} from '@/lib/supabase/server';
import { isDriveConfigured, listFilesRecursive } from '@/lib/google/drive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** How long an index stays good enough to skip a refresh. */
const FRESH_MINUTES = 10;

export async function POST(request) {
  if (!isServerSupabaseConfigured()) {
    return NextResponse.json({ ok: false, skipped: 'no-database' });
  }
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });

  // Not an error, and deliberately not a 503: the Docs tab calls this on every
  // open, and a firm that has not connected Drive should see a quiet "nothing
  // to do", not a red console full of failed requests.
  if (!isDriveConfigured()) {
    return NextResponse.json({ ok: false, skipped: 'drive-not-configured' });
  }

  const { matterId, force = false } = await request.json().catch(() => ({}));
  if (!matterId) return NextResponse.json({ error: 'matterId is required.' }, { status: 400 });

  const db = await getSupabaseServerClient();
  const { data: matter, error } = await db
    .from('matter')
    .select('id, drive_folder_id, drive_folder_name, drive_indexed_at')
    .eq('id', matterId)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!matter?.drive_folder_id) {
    return NextResponse.json({ ok: false, skipped: 'no-folder-linked' });
  }

  if (!force && matter.drive_indexed_at) {
    const ageMinutes = (Date.now() - new Date(matter.drive_indexed_at).getTime()) / 60000;
    if (ageMinutes < FRESH_MINUTES) {
      return NextResponse.json({ ok: true, skipped: 'fresh', ageMinutes: Math.round(ageMinutes) });
    }
  }

  const result = await indexOneMatter(db, matter);
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}

/**
 * Walk a folder and reconcile the index against it.
 *
 * Exported so the batch sweep and this endpoint cannot drift apart — two
 * implementations of "index a matter" is two places for the trashed-file
 * reconciliation below to be got subtly wrong.
 */
export async function indexOneMatter(db, matter) {
  const listed = await listFilesRecursive(matter.drive_folder_id);
  if (!listed.ok) return { ok: false, matterId: matter.id, error: listed.error };

  const now = new Date().toISOString();
  const rows = listed.files.map((f) => ({
    matter_id: matter.id,
    provider: 'drive',
    external_id: f.id,
    name: f.name,
    mime_type: f.mimeType || null,
    // Drive returns size as a STRING and only for binary files -- a Google Doc
    // has no byte size at all. Number('') is 0, which would report every Doc as
    // an empty file, so the absent case stays null.
    size_bytes: f.size != null ? Number(f.size) : null,
    folder_path: f.folderPath || '',
    web_view_link: f.webViewLink || null,
    created_time: f.createdTime || null,
    modified_time: f.modifiedTime || null,
    trashed: false,
    indexed_at: now,
  }));

  if (rows.length) {
    const { error } = await db.from('document').upsert(rows, { onConflict: 'provider,external_id' });
    if (error) return { ok: false, matterId: matter.id, error: error.message };
  }

  // A file deleted in Drive must stop appearing here. Marked trashed rather
  // than deleted, so the row survives as evidence it once existed -- "was this
  // ever on the file?" is a question that gets asked.
  const seen = rows.map((r) => r.external_id);
  let stale = db.from('document').update({ trashed: true })
    .eq('matter_id', matter.id).eq('provider', 'drive').eq('trashed', false);
  if (seen.length) stale = stale.not('external_id', 'in', `(${seen.map((s) => `"${s}"`).join(',')})`);
  await stale;

  await db.from('matter').update({ drive_indexed_at: now }).eq('id', matter.id);

  return {
    ok: true,
    matterId: matter.id,
    folder: matter.drive_folder_name,
    files: rows.length,
    truncated: listed.truncated,
    indexedAt: now,
  };
}
