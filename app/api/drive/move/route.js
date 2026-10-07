/**
 * Move a document from one folder of a case to another.
 *
 * GET   ?matterId=…                       the case's folders, for "Move to"
 * POST  { matterId, fileId, toFolderId }  move it
 *
 * Asked for 2026-10-07, after deposition transcripts had been filed into
 * Discovery: staff needed a way to put them right without leaving the app.
 *
 * ⚠️ BOTH ENDS ARE CHECKED AGAINST THE CASE (planMove in drive-paths.js).
 * The service account can reach every case in the firm's Drive; without the
 * check, a signed-in user could move another case's file into this one, or
 * this case's file out of it, by id.
 *
 * Drive keeps the file's id and link through a move, so the links already on
 * the case's rows keep working and nothing in the database changes.
 */

import { NextResponse } from 'next/server';
import { getCurrentUser, getSupabaseServerClient, isServerSupabaseConfigured } from '@/lib/supabase/server';
import { isDriveConfigured, folderTree, getFile, moveFile } from '@/lib/google/drive';
import { moveTargets, planMove } from '@/lib/google/drive-paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The signed-in user, the case's Drive folder and its tree -- or the response explaining why not. */
async function caseTree(matterId) {
  if (!isServerSupabaseConfigured()) {
    return { fail: NextResponse.json({ error: 'The database is not configured.' }, { status: 503 }) };
  }
  const user = await getCurrentUser();
  if (!user) return { fail: NextResponse.json({ error: 'Sign in required.' }, { status: 401 }) };
  if (!isDriveConfigured()) {
    return { fail: NextResponse.json({ error: 'Google Drive is not connected.' }, { status: 503 }) };
  }
  if (!matterId) return { fail: NextResponse.json({ error: 'matterId is required.' }, { status: 400 }) };

  const db = await getSupabaseServerClient();
  const { data: matter, error } = await db
    .from('matter')
    .select('id, drive_folder_id')
    .eq('id', matterId)
    .single();
  if (error) return { fail: NextResponse.json({ error: error.message }, { status: 500 }) };
  if (!matter?.drive_folder_id) {
    return { fail: NextResponse.json({ error: 'This case has no Drive folder linked.' }, { status: 400 }) };
  }

  const root = matter.drive_folder_id;
  const tree = await folderTree(root);
  if (!tree.ok) return { fail: NextResponse.json({ error: tree.error }, { status: 502 }) };
  return { root, tree };
}

export async function GET(request) {
  const matterId = request.nextUrl.searchParams.get('matterId');
  const { fail, root, tree } = await caseTree(matterId);
  if (fail) return fail;
  return NextResponse.json({ folders: moveTargets(tree.folders, root, 'Case folder (top level)') });
}

export async function POST(request) {
  const { matterId, fileId, toFolderId } = await request.json().catch(() => ({}));
  if (!fileId || !toFolderId) {
    return NextResponse.json({ error: 'fileId and toFolderId are required.' }, { status: 400 });
  }
  const { fail, root, tree } = await caseTree(matterId);
  if (fail) return fail;

  const got = await getFile(fileId);
  if (!got.ok) return NextResponse.json({ error: got.error }, { status: got.status === 404 ? 404 : 502 });
  if (got.file.trashed) return NextResponse.json({ error: 'That document is in the trash.' }, { status: 400 });

  const plan = planMove({ file: got.file, toFolderId, rootId: root, byId: tree.byId });
  if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: 403 });
  if (plan.already) return NextResponse.json({ ok: true, unchanged: true });

  const moved = await moveFile({ fileId, toFolderId, removeParents: plan.removeParents });
  if (!moved.ok) {
    // The likely refusal on a Shared Drive: moving needs more than upload rights.
    const forbidden = moved.status === 403;
    return NextResponse.json(
      {
        error: forbidden
          ? `Drive refused the move (${moved.error}). The app's Drive account needs the "Content manager" role on the shared drive to move files.`
          : moved.error,
      },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, file: moved.file });
}
