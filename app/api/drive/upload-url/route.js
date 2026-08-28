/**
 * Mint a resumable upload session for a folder inside a matter.
 *
 * The browser sends the bytes; this only says "yes, you may write here" and
 * asks Drive to open a session. See createUploadSession for why the file never
 * passes through the server.
 *
 * Ancestry is verified exactly as in /api/drive/browse. A write endpoint that
 * skipped it would be worse than a read one: it would let a signed-in user drop
 * files into any folder the impersonated account can reach.
 */

import { NextResponse } from 'next/server';
import {
  getSupabaseServerClient, getCurrentUser, isServerSupabaseConfigured,
} from '@/lib/supabase/server';
import {
  isDriveConfigured, driveConfig, createUploadSession, folderTree,
} from '@/lib/google/drive';
import { isWithinTree } from '@/lib/google/drive-paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Drive's own per-file ceiling is far higher; this is a sanity bound. */
const MAX_BYTES = 500 * 1024 * 1024;

export async function POST(request) {
  if (!isServerSupabaseConfigured()) {
    return NextResponse.json({ error: 'The database is not configured.' }, { status: 503 });
  }
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  if (!isDriveConfigured()) {
    return NextResponse.json({ error: 'Google Drive is not connected.' }, { status: 503 });
  }

  // Uploading without delegation cannot work, and saying so here is far kinder
  // than letting Drive answer `storageQuotaExceeded` after the user has picked
  // a file and waited.
  if (!driveConfig().impersonate) {
    return NextResponse.json(
      {
        error:
          'Uploading needs GOOGLE_IMPERSONATE_USER. A service account owns no Drive storage, so a file it would own is refused. Point it at a durable account such as files@higdonlawyers.com and authorise domain-wide delegation — see docs/GOOGLE_DRIVE_SETUP.md, Level 2.',
        needsImpersonation: true,
      },
      { status: 503 }
    );
  }

  const { matterId, parentId, name, mimeType, sizeBytes } = await request.json().catch(() => ({}));
  if (!matterId || !name?.trim()) {
    return NextResponse.json({ error: 'matterId and name are required.' }, { status: 400 });
  }
  if (sizeBytes && sizeBytes > MAX_BYTES) {
    return NextResponse.json({ error: 'That file is over 500 MB.' }, { status: 413 });
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

  const session = await createUploadSession({
    parentId: target,
    name: name.trim(),
    mimeType,
    sizeBytes,
  });
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 502 });

  return NextResponse.json({ ok: true, sessionUrl: session.sessionUrl });
}
