/**
 * List one folder inside one matter's Drive folder.
 *
 * ⚠️ THE ANCESTRY CHECK IS NOT OPTIONAL.
 *
 * Without it this endpoint lists any folder the service account can see, given
 * only its id — and the service account can see the parent that holds every
 * case in the firm. A signed-in user could enumerate the whole docket by
 * passing ids.
 *
 * Today the blast radius is genuinely small: everyone at this firm sees every
 * matter, which is why RLS is a blanket policy. But an endpoint whose safety
 * depends on that staying true is a trap for whoever adds per-matter
 * permissions later, and they will not think to look here.
 */

import { NextResponse } from 'next/server';
import {
  getSupabaseServerClient, getCurrentUser, isServerSupabaseConfigured,
} from '@/lib/supabase/server';
import { isDriveConfigured, listFolder, folderTree } from '@/lib/google/drive';
import { isWithinTree, breadcrumb, FOLDER_MIME } from '@/lib/google/drive-paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  if (!isServerSupabaseConfigured()) {
    return NextResponse.json(
      { error: 'The database is not configured. Running on local storage, so there is nothing to browse.' },
      { status: 503 }
    );
  }
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  if (!isDriveConfigured()) {
    return NextResponse.json({ error: 'Google Drive is not connected.' }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const matterId = searchParams.get('matterId');
  const requested = searchParams.get('folderId');
  if (!matterId) return NextResponse.json({ error: 'matterId is required.' }, { status: 400 });

  const db = await getSupabaseServerClient();
  const { data: matter, error } = await db
    .from('matter')
    .select('id, drive_folder_id, drive_folder_name')
    .eq('id', matterId)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!matter?.drive_folder_id) {
    return NextResponse.json({ ok: true, linked: false, children: [], trail: [] });
  }

  const root = matter.drive_folder_id;
  const folderId = requested || root;

  // The tree is folders only, so it stays cheap however many files a case has.
  const tree = await folderTree(root);
  if (!tree.ok) return NextResponse.json({ error: tree.error }, { status: 502 });

  if (!isWithinTree(folderId, root, tree.byId)) {
    // Deliberately not 404: the caller asked for something real and was
    // refused. Saying "not found" would invite retrying with other ids.
    return NextResponse.json(
      { error: 'That folder is not inside this case.' },
      { status: 403 }
    );
  }

  const listed = await listFolder(folderId);
  if (!listed.ok) return NextResponse.json({ error: listed.error }, { status: 502 });

  return NextResponse.json({
    ok: true,
    linked: true,
    rootId: root,
    rootName: matter.drive_folder_name || 'Case folder',
    folderId,
    // Root-first, root excluded -- the UI renders the case name itself.
    trail: breadcrumb(folderId, root, tree.byId),
    children: listed.children.map((c) => ({
      id: c.id,
      name: c.name,
      isFolder: c.mimeType === FOLDER_MIME,
      mimeType: c.mimeType,
      // Drive returns size as a STRING, and only for binary files -- a Google
      // Doc has no byte size at all. Number('') is 0, which would report every
      // Doc as empty, so absent stays null.
      sizeBytes: c.size != null ? Number(c.size) : null,
      modifiedTime: c.modifiedTime || null,
      webViewLink: c.webViewLink || null,
    })),
    treeTruncated: tree.truncated,
  });
}
