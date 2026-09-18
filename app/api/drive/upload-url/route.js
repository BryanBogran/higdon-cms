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
  isDriveConfigured, driveConfig, createUploadSession, folderTree, resolveSubfolder,
} from '@/lib/google/drive';
import { isWithinTree } from '@/lib/google/drive-paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A sanity bound, not a technical one.
 *
 * ── Why it was 500 MB, and why that was wrong ────────────────────────────
 *
 * Nothing in the pipeline needed it. The bytes never pass through this server:
 * createUploadSession hands the browser a resumable session URL and the file
 * goes straight to Google, so a large upload costs this app no memory, no
 * execution time and no transfer. Drive's own per-file ceiling is 5 TB.
 *
 * The number was a guess, and it was the wrong guess for the one section that
 * most needed a large file. ⚠️ A VIDEO DEPOSITION IS ROUTINELY 1-4 GB. The
 * firm hit this on Depositions, which is exactly where it would hurt: the
 * recording of a deposition is not something you can shrink or split, and the
 * error said only that the file was too big.
 *
 * 5 GB keeps a bound against a mis-selected file or a runaway export while
 * clearing real evidence with room to spare.
 *
 * The real constraint is the firm's Google Workspace storage pool, which is
 * theirs to manage and says so plainly when it runs out — a far better failure
 * than a number invented here.
 */
const MAX_BYTES = 5 * 1024 * 1024 * 1024;

/** Whole GB reads better than 5368709120 in an error message. */
const gb = (bytes) => `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;

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

  // `folderName` lets a field say "Medical Records" without knowing any ids.
  const { matterId, parentId, folderName, name, mimeType, sizeBytes } =
    await request.json().catch(() => ({}));
  if (!matterId || !name?.trim()) {
    return NextResponse.json({ error: 'matterId and name are required.' }, { status: 400 });
  }
  if (sizeBytes && sizeBytes > MAX_BYTES) {
    // Say both numbers. "Too large" without a size leaves the person guessing
    // whether it is off by a little or by a lot.
    return NextResponse.json(
      { error: `That file is ${gb(sizeBytes)}. The limit is ${gb(MAX_BYTES)}.` },
      { status: 413 },
    );
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
  let target = parentId || root;

  if (!parentId && folderName) {
    // Resolved server-side rather than trusted from the client: a name cannot
    // be used to reach outside the case, where a raw id could.
    const sub = await resolveSubfolder(root, folderName);
    if (!sub.ok) return NextResponse.json({ error: sub.error }, { status: 502 });
    target = sub.folderId;
  }

  const tree = await folderTree(root);
  if (!tree.ok) return NextResponse.json({ error: tree.error }, { status: 502 });
  if (!isWithinTree(target, root, tree.byId)) {
    return NextResponse.json({ error: 'That folder is not inside this case.' }, { status: 403 });
  }

  /*
   * The browser's origin has to be declared when the SESSION is created, not
   * when the bytes are sent.
   *
   * Without it Google completes the upload and answers 200 with the file
   * metadata, but omits Access-Control-Allow-Origin from that final response --
   * so the browser discards it as net::ERR_FAILED. The file is in Drive and
   * the app reports a failed upload. Staff then retry, and Drive fills with
   * duplicates. Verified directly against Google: with the header the final
   * 200 carries the ACAO, without it the header is absent. A resume/status
   * query (308) carries it either way, which is what makes this so easy to
   * misdiagnose.
   *
   * The header is only used if it matches this deployment's own origin. It is
   * client-supplied, and there is no reason to let a caller decide which
   * origin Google should bless.
   */
  const selfOrigin = new URL(request.url).origin;
  const claimed = request.headers.get('origin') || '';
  const origin = claimed === selfOrigin ? claimed : selfOrigin;

  const session = await createUploadSession({
    parentId: target,
    name: name.trim(),
    mimeType,
    sizeBytes,
    origin,
  });
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 502 });

  return NextResponse.json({ ok: true, sessionUrl: session.sessionUrl });
}
