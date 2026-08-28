/**
 * Give a matter a Drive folder — adopting an existing one if there is one.
 *
 * Called after a matter is created, and available from the Docs tab for cases
 * that never got one.
 *
 * ── Adopt before create ───────────────────────────────────────────────────
 * Intake making the folder first and the matter being opened later is the
 * normal order of events at this firm. Creating a second folder with the same
 * name is how a case ends up with half its documents in each, and nobody
 * notices until someone cannot find a record.
 *
 * So: look for an unambiguous existing folder, adopt it, and only create when
 * there is genuinely nothing to adopt.
 *
 * ── This must never block making a matter ─────────────────────────────────
 * Creating the case is the real action; the folder is a convenience. Every
 * failure here returns 200 with `ok: false` and a reason, so the caller can
 * mention it without the matter appearing to have failed. A firm that cannot
 * open a file because Drive is down is a worse outcome than a missing folder.
 */

import { NextResponse } from 'next/server';
import {
  getSupabaseServerClient, getCurrentUser, isServerSupabaseConfigured,
} from '@/lib/supabase/server';
import {
  isDriveConfigured, driveConfig, listChildFolders, createFolder,
} from '@/lib/google/drive';
import { caseFolderName, findExistingCaseFolder, CASE_SUBFOLDERS } from '@/lib/domain/drive-match';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Soft failure: the matter is fine, the folder is not. Always HTTP 200. */
const soft = (reason, extra = {}) => NextResponse.json({ ok: false, reason, ...extra });

export async function POST(request) {
  if (!isServerSupabaseConfigured()) return soft('no-database');
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  if (!isDriveConfigured()) return soft('drive-not-configured');

  const { matterId, withSubfolders = true } = await request.json().catch(() => ({}));
  if (!matterId) return NextResponse.json({ error: 'matterId is required.' }, { status: 400 });

  const db = await getSupabaseServerClient();
  const { data: matter, error } = await db
    .from('matter')
    .select('id, client_name, case_number, drive_folder_id')
    .eq('id', matterId)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Already has one. Calling twice must not make a second folder.
  if (matter.drive_folder_id) {
    return NextResponse.json({ ok: true, alreadyLinked: true, folderId: matter.drive_folder_id });
  }

  const root = driveConfig().rootFolderId;
  const values = { clientName: matter.client_name, caseNumber: matter.case_number };
  const wanted = caseFolderName(values);

  const listed = await listChildFolders(root);
  if (!listed.ok) return soft('drive-unreachable', { error: listed.error });

  // Folders already spoken for. One folder, one case.
  const { data: linkedRows } = await db
    .from('matter')
    .select('drive_folder_id')
    .not('drive_folder_id', 'is', null);
  const taken = new Set((linkedRows || []).map((r) => r.drive_folder_id));

  const existing = findExistingCaseFolder(listed.folders, values, { linkedFolderIds: taken });

  let folder = existing;
  let created = false;
  const subfolders = [];

  if (!folder) {
    const made = await createFolder({ parentId: root, name: wanted });
    if (!made.ok) {
      const quota = /storage quota/i.test(made.error || '');
      return soft(quota ? 'needs-impersonation' : 'create-failed', {
        error: quota
          ? 'Drive refused: a service account owns no storage. Set GOOGLE_IMPERSONATE_USER to a durable account (files@) and authorise domain-wide delegation with the full drive scope — see docs/GOOGLE_DRIVE_SETUP.md, Level 2.'
          : made.error,
      });
    }
    folder = made.folder;
    created = true;

    // Subfolders only on a folder we just made. Imposing a structure on one
    // somebody already organised is rearranging their filing cabinet.
    if (withSubfolders) {
      for (const name of CASE_SUBFOLDERS) {
        const sub = await createFolder({ parentId: folder.id, name });
        // A failed subfolder is not worth failing the whole thing over -- the
        // case folder exists and staff can add the rest.
        if (sub.ok) subfolders.push(name);
      }
    }
  }

  const { error: linkError } = await db
    .from('matter')
    .update({
      drive_folder_id: folder.id,
      drive_folder_name: folder.name || wanted,
      drive_linked_at: new Date().toISOString(),
      drive_linked_by: user.id,
    })
    .eq('id', matterId)
    .is('drive_folder_id', null);

  if (linkError) {
    // 23505 is matter_drive_folder_uq: something else claimed this folder
    // between the read and the write.
    return soft(linkError.code === '23505' ? 'folder-already-claimed' : 'link-failed', {
      error: linkError.message,
    });
  }

  return NextResponse.json({
    ok: true,
    created,
    adopted: Boolean(existing),
    folderId: folder.id,
    folderName: folder.name || wanted,
    webViewLink: folder.webViewLink || null,
    subfolders,
  });
}
