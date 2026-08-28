/**
 * Search Drive — scoped to one matter, or across every case.
 *
 * Drive matches text INSIDE PDFs and Docs via `fullText`. That is the capability
 * the document index this replaced could never have, and the reason dropping it
 * made search better rather than worse.
 *
 * Scoped and firm-wide take different routes for a real reason. Drive has no
 * "search this subtree" operator — `in parents` means immediate children — so a
 * scoped search must name every folder in the case. That is affordable for one
 * case and not for four hundred, so firm-wide searches unscoped and maps each
 * hit back to a case by walking its parents.
 */

import { NextResponse } from 'next/server';
import {
  getSupabaseServerClient, getCurrentUser, isServerSupabaseConfigured,
} from '@/lib/supabase/server';
import { isDriveConfigured, driveConfig, searchFiles, folderTree } from '@/lib/google/drive';
import { matterForFile, MAX_SCOPED_FOLDERS } from '@/lib/google/drive-paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  if (!isServerSupabaseConfigured()) {
    return NextResponse.json({ error: 'The database is not configured.' }, { status: 503 });
  }
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  if (!isDriveConfigured()) {
    return NextResponse.json({ error: 'Google Drive is not connected.' }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const term = (searchParams.get('q') || '').trim();
  const matterId = searchParams.get('matterId');

  // A blank search would return the whole Drive newest-first, which looks like
  // a result and is not one.
  if (term.length < 2) {
    return NextResponse.json({ ok: true, files: [], reason: 'term-too-short' });
  }

  const db = await getSupabaseServerClient();

  /* ---------------- one case ---------------- */
  if (matterId) {
    const { data: matter, error } = await db
      .from('matter')
      .select('id, drive_folder_id')
      .eq('id', matterId)
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!matter?.drive_folder_id) return NextResponse.json({ ok: true, files: [], linked: false });

    const tree = await folderTree(matter.drive_folder_id);
    if (!tree.ok) return NextResponse.json({ error: tree.error }, { status: 502 });

    const ids = [matter.drive_folder_id, ...tree.folders.map((f) => f.id)];
    const res = await searchFiles(term, { folderIds: ids });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 502 });

    return NextResponse.json({
      ok: true,
      files: res.files.map(shape),
      // Said out loud rather than silently returning a partial answer: past the
      // cap the folder scope is dropped, so results may include other cases.
      scopeDropped: ids.length > MAX_SCOPED_FOLDERS,
    });
  }

  /* ---------------- every case ---------------- */
  const res = await searchFiles(term, {});
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 502 });

  const { data: matters } = await db
    .from('matter')
    .select('id, client_name, case_number, drive_folder_id')
    .not('drive_folder_id', 'is', null)
    .is('deleted_at', null);

  const matterByFolder = new Map((matters || []).map((m) => [m.drive_folder_id, m.id]));
  const matterById = new Map((matters || []).map((m) => [m.id, m]));

  // One tree over the whole root, so a hit two folders deep still resolves.
  const tree = await folderTree(driveConfig().rootFolderId, { maxDepth: 5, maxFolders: 2000 });
  const byId = tree.ok ? tree.byId : new Map();

  const files = res.files.map((f) => {
    const id = matterForFile(f, byId, matterByFolder);
    const m = id ? matterById.get(id) : null;
    return {
      ...shape(f),
      matterId: id,
      // Null rather than a guess. A file loose in the parent folder belongs to
      // no case, and saying so is more useful than attaching it to the nearest.
      matterLabel: m ? `${m.client_name}${m.case_number ? ` ${m.case_number}` : ''}` : null,
    };
  });

  return NextResponse.json({ ok: true, files });
}

function shape(f) {
  return {
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    sizeBytes: f.size != null ? Number(f.size) : null,
    modifiedTime: f.modifiedTime || null,
    webViewLink: f.webViewLink || null,
  };
}
