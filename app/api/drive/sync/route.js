/**
 * Drive sync — link case folders, then index the files inside them.
 *
 * Two steps, deliberately separate and separately callable:
 *
 *   GET   ?step=plan     dry run. Reads Drive, matches, changes NOTHING.
 *   POST  {step:'link'}  apply the unambiguous links; queue the rest for review
 *   POST  {step:'files'} index files for a batch of already-linked matters
 *
 * A dry run exists because "it silently attached two hundred folders to cases"
 * is not a thing you want to find out about afterwards. The plan is shown, a
 * human agrees, and only then does anything write.
 *
 * Files are indexed in BATCHES with a cursor rather than all at once. A firm
 * with 400 matters and a few thousand documents will not finish inside a
 * serverless request, and a job that times out halfway through while reporting
 * success is worse than one that says "180 left".
 *
 * This runs as the SIGNED-IN USER, not the service role: RLS applies, and the
 * audit trigger records who linked what. The email webhook uses service role
 * because a mail provider has no session; a person clicking Sync does.
 */

import { NextResponse } from 'next/server';
import {
  getSupabaseServerClient, getCurrentUser, isServerSupabaseConfigured,
} from '@/lib/supabase/server';
import {
  isDriveConfigured, driveConfig, listChildFolders, listFilesRecursive, diagnoseDrive,
} from '@/lib/google/drive';
import { planSync } from '@/lib/domain/drive-match';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Matters in the app's shape, which is what drive-match expects. */
async function loadMatters(db) {
  const { data, error } = await db
    .from('matter')
    .select('id, client_name, case_number, drive_folder_id, deleted_at');
  if (error) return { ok: false, error: error.message };

  const matters = {};
  for (const row of data || []) {
    matters[row.id] = {
      values: { clientName: row.client_name, caseNumber: row.case_number },
      driveFolderId: row.drive_folder_id,
      archivedAt: row.deleted_at || undefined,
    };
  }
  return { ok: true, matters };
}

async function guard() {
  // Checked before anything else: without a database there is no session to
  // read, and createServerClient would throw an unexplained 500.
  if (!isServerSupabaseConfigured()) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: 'The database is not configured. Running on local storage, so there is nothing to sync into.' },
        { status: 503 }
      ),
    };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, res: NextResponse.json({ error: 'Sign in required.' }, { status: 401 }) };
  if (!isDriveConfigured()) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: 'Google Drive is not configured. See docs/GOOGLE_DRIVE_SETUP.md.' },
        { status: 503 }
      ),
    };
  }
  return { ok: true, user };
}

export async function GET() {
  const g = await guard();
  if (!g.ok) return g.res;

  const db = await getSupabaseServerClient();
  const loaded = await loadMatters(db);
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: 500 });

  const listed = await listChildFolders(driveConfig().rootFolderId);
  if (!listed.ok) return NextResponse.json({ error: listed.error }, { status: 502 });

  const plan = planSync(listed.folders, loaded.matters);

  // Zero folders has three quite different causes that look identical from
  // here, so ask Drive rather than making the UI guess out loud.
  const diagnosis = listed.folders.length === 0 ? await diagnoseDrive() : null;

  // Counts and a small sample, not the whole plan: a firm with 400 folders
  // does not need 400 rows in a preview to decide whether to press the button.
  return NextResponse.json({
    diagnosis,
    ok: true,
    folders: listed.folders.length,
    counts: {
      alreadyLinked: plan.linked.length,
      willLink: plan.auto.length,
      needsReview: plan.ambiguous.length,
      unmatched: plan.unmatched.length,
    },
    willLink: plan.auto.slice(0, 25).map((p) => ({
      folder: p.folder.name,
      matterId: p.matterId,
      reason: p.reason,
    })),
    needsReview: plan.ambiguous.slice(0, 25).map((p) => ({
      folder: p.folder.name,
      candidates: p.candidates,
    })),
  });
}

export async function POST(request) {
  const g = await guard();
  if (!g.ok) return g.res;

  const { step = 'link', batchSize = 20 } = await request.json().catch(() => ({}));
  const db = await getSupabaseServerClient();

  if (step === 'link') return linkFolders(db, g.user);
  if (step === 'files') return indexFiles(db, Math.min(Math.max(1, batchSize), 50));
  return NextResponse.json({ error: `Unknown step "${step}".` }, { status: 400 });
}

/* ------------------------------------------------------------------ */

async function linkFolders(db, user) {
  const loaded = await loadMatters(db);
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: 500 });

  const listed = await listChildFolders(driveConfig().rootFolderId);
  if (!listed.ok) return NextResponse.json({ error: listed.error }, { status: 502 });

  const plan = planSync(listed.folders, loaded.matters);
  const failed = [];
  let linked = 0;

  for (const item of plan.auto) {
    const { error } = await db
      .from('matter')
      .update({
        drive_folder_id: item.folder.id,
        drive_folder_name: item.folder.name,
        drive_linked_at: new Date().toISOString(),
        drive_linked_by: user.id,
      })
      .eq('id', item.matterId)
      .is('drive_folder_id', null); // never re-point an existing link

    if (error) failed.push({ folder: item.folder.name, error: error.message });
    else linked++;
  }

  // Everything uncertain becomes a row in a work queue, not a log line.
  // Upserted, so re-running the sync updates the candidate list rather than
  // resurrecting a review somebody already dismissed.
  const reviews = [...plan.ambiguous, ...plan.unmatched].map((p) => ({
    folder_id: p.folder.id,
    folder_name: p.folder.name,
    candidates: p.candidates || [],
    reason: p.status,
    seen_at: new Date().toISOString(),
  }));

  if (reviews.length) {
    const { error } = await db
      .from('drive_folder_review')
      .upsert(reviews, { onConflict: 'folder_id', ignoreDuplicates: false });
    if (error) failed.push({ folder: '(review queue)', error: error.message });
  }

  return NextResponse.json({
    ok: failed.length === 0,
    linked,
    queuedForReview: reviews.length,
    alreadyLinked: plan.linked.length,
    failed,
  });
}

async function indexFiles(db, batchSize) {
  // Oldest-indexed first, so repeated calls sweep everything rather than
  // re-doing the same matters.
  const { data: matters, error } = await db
    .from('matter')
    .select('id, drive_folder_id, drive_folder_name')
    .not('drive_folder_id', 'is', null)
    .is('deleted_at', null)
    .order('drive_linked_at', { ascending: true, nullsFirst: true })
    .limit(batchSize);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results = [];
  let indexed = 0;

  for (const m of matters || []) {
    const listed = await listFilesRecursive(m.drive_folder_id);
    if (!listed.ok) {
      results.push({ matterId: m.id, error: listed.error });
      continue;
    }

    const rows = listed.files.map((f) => ({
      matter_id: m.id,
      provider: 'drive',
      external_id: f.id,
      name: f.name,
      mime_type: f.mimeType || null,
      // Drive returns size as a STRING, and only for binary files -- a Google
      // Doc has no byte size at all. Number('') is 0, which would report every
      // Doc as an empty file, so the absent case stays null.
      size_bytes: f.size != null ? Number(f.size) : null,
      folder_path: f.folderPath || '',
      web_view_link: f.webViewLink || null,
      created_time: f.createdTime || null,
      modified_time: f.modifiedTime || null,
      trashed: false,
      indexed_at: new Date().toISOString(),
    }));

    if (rows.length) {
      const { error: upsertError } = await db
        .from('document')
        .upsert(rows, { onConflict: 'provider,external_id' });
      if (upsertError) {
        results.push({ matterId: m.id, error: upsertError.message });
        continue;
      }
    }

    // A file deleted in Drive must stop appearing here. Marked trashed rather
    // than deleted, so the row survives as evidence that it once existed --
    // "this document used to be on the file" is a question that gets asked.
    const seen = rows.map((r) => r.external_id);
    const stale = db.from('document').update({ trashed: true }).eq('matter_id', m.id).eq('provider', 'drive');
    await (seen.length ? stale.not('external_id', 'in', `(${seen.map((s) => `"${s}"`).join(',')})`) : stale);

    indexed += rows.length;
    results.push({ matterId: m.id, folder: m.drive_folder_name, files: rows.length, truncated: listed.truncated });
  }

  const { count: remaining } = await db
    .from('matter')
    .select('id', { count: 'exact', head: true })
    .not('drive_folder_id', 'is', null)
    .is('deleted_at', null);

  return NextResponse.json({
    ok: true,
    matters: results.length,
    indexed,
    totalLinkedMatters: remaining ?? null,
    results,
  });
}
