/**
 * Resolving a Drive folder the sync would not link on its own.
 *
 * GET   list the open reviews
 * POST  { folderId, folderName, matterId }  link it, by hand
 * POST  { folderId, dismiss: true }         not a case folder; stop asking
 *
 * This is the human half of the matching rule in lib/domain/drive-match.js.
 * That file refuses to guess; this is where somebody decides. The refusal is
 * only defensible if deciding is easy, which is why this exists at all rather
 * than the ambiguous folders being written to a log nobody reads.
 */

import { NextResponse } from 'next/server';
import {
  getSupabaseServerClient, getCurrentUser, isServerSupabaseConfigured,
} from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Database first: without one there is no session, and no useful 500. */
function notConfigured() {
  return isServerSupabaseConfigured()
    ? null
    : NextResponse.json(
        { error: 'The database is not configured. Running on local storage, so there is nothing to review.' },
        { status: 503 }
      );
}

export async function GET() {
  const down = notConfigured();
  if (down) return down;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });

  const db = await getSupabaseServerClient();
  const { data, error } = await db
    .from('drive_folder_review')
    .select('*')
    .eq('dismissed', false)
    .order('seen_at', { ascending: false })
    .limit(500);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, reviews: data || [] });
}

export async function POST(request) {
  const down = notConfigured();
  if (down) return down;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });

  const { folderId, folderName, matterId, dismiss } = await request.json().catch(() => ({}));
  if (!folderId) return NextResponse.json({ error: 'folderId is required.' }, { status: 400 });

  const db = await getSupabaseServerClient();

  if (dismiss) {
    const { error } = await db
      .from('drive_folder_review')
      .update({ dismissed: true })
      .eq('folder_id', folderId);
    return error
      ? NextResponse.json({ error: error.message }, { status: 500 })
      : NextResponse.json({ ok: true, dismissed: true });
  }

  if (!matterId) return NextResponse.json({ error: 'matterId is required.' }, { status: 400 });

  // `.is('drive_folder_id', null)` is the guard that makes this safe to click
  // twice, and safe to click on a matter someone else just linked. Without it
  // a double submit would re-point a case at a different folder, which is the
  // exact failure the matching rules exist to prevent -- and it would be this
  // endpoint, not the matcher, that caused it.
  const { data, error } = await db
    .from('matter')
    .update({
      drive_folder_id: folderId,
      drive_folder_name: folderName || null,
      drive_linked_at: new Date().toISOString(),
      drive_linked_by: user.id,
    })
    .eq('id', matterId)
    .is('drive_folder_id', null)
    .select('id');

  if (error) {
    // 23505 is matter_drive_folder_uq: this FOLDER is already on another case.
    const conflict = error.code === '23505';
    return NextResponse.json(
      {
        error: conflict
          ? 'That folder is already linked to a different case.'
          : error.message,
      },
      { status: conflict ? 409 : 500 }
    );
  }

  if (!data?.length) {
    return NextResponse.json(
      { error: 'That case already has a Drive folder. Unlink it first if this is a correction.' },
      { status: 409 }
    );
  }

  await db.from('drive_folder_review').update({ dismissed: true }).eq('folder_id', folderId);
  return NextResponse.json({ ok: true, matterId });
}
