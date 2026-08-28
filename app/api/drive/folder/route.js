/**
 * Create a folder inside a matter's Drive folder.
 *
 * Same ancestry rule as browsing, for the same reason: without it, a signed-in
 * user could create folders anywhere the service account can reach, including
 * inside other firms' cases.
 *
 * ⚠️ A SERVICE ACCOUNT OWNS NO STORAGE. Uploading a file it would own fails
 * with `storageQuotaExceeded`. A folder is zero bytes, so this MIGHT succeed
 * where an upload cannot — I genuinely do not know, and rather than guess, the
 * error path names the fix if Drive refuses.
 */

import { NextResponse } from 'next/server';
import {
  getSupabaseServerClient, getCurrentUser, isServerSupabaseConfigured,
} from '@/lib/supabase/server';
import { isDriveConfigured, createFolder, folderTree } from '@/lib/google/drive';
import { isWithinTree } from '@/lib/google/drive-paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  if (!isServerSupabaseConfigured()) {
    return NextResponse.json({ error: 'The database is not configured.' }, { status: 503 });
  }
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  if (!isDriveConfigured()) {
    return NextResponse.json({ error: 'Google Drive is not connected.' }, { status: 503 });
  }

  const { matterId, parentId, name } = await request.json().catch(() => ({}));
  if (!matterId || !name?.trim()) {
    return NextResponse.json({ error: 'matterId and name are required.' }, { status: 400 });
  }

  const db = await getSupabaseServerClient();
  const { data: matter, error } = await db
    .from('matter')
    .select('id, drive_folder_id')
    .eq('id', matterId)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!matter?.drive_folder_id) {
    return NextResponse.json({ error: 'This case has no Drive folder linked.' }, { status: 400 });
  }

  const root = matter.drive_folder_id;
  const target = parentId || root;

  const tree = await folderTree(root);
  if (!tree.ok) return NextResponse.json({ error: tree.error }, { status: 502 });
  if (!isWithinTree(target, root, tree.byId)) {
    return NextResponse.json({ error: 'That folder is not inside this case.' }, { status: 403 });
  }

  const created = await createFolder({ parentId: target, name: name.trim() });
  if (!created.ok) {
    // The one failure worth explaining, because Drive's own message does not.
    const quota = /storage quota/i.test(created.error || '');
    return NextResponse.json(
      {
        error: quota
          ? 'Drive refused: a service account owns no storage. Set GOOGLE_IMPERSONATE_USER to a real account (files@) and authorise domain-wide delegation — see docs/GOOGLE_DRIVE_SETUP.md, Level 2.'
          : created.error,
      },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true, folder: created.folder });
}
