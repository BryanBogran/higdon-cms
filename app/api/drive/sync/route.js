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
  isDriveConfigured, driveConfig, listChildFolders, diagnoseDrive,
} from '@/lib/google/drive';
import { planSync, planCreateFromFolders } from '@/lib/domain/drive-match';

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
  // What a "Create projects" press would do, so the button can carry a
  // number instead of asking someone to press it and find out.
  const creation = planCreateFromFolders(listed.folders, loaded.matters);

  return NextResponse.json({
    diagnosis,
    ok: true,
    folders: listed.folders.length,
    counts: {
      alreadyLinked: plan.linked.length,
      willLink: plan.auto.length,
      needsReview: plan.ambiguous.length,
      unmatched: plan.unmatched.length,
      willCreate: creation.create.length,
      createSkipped: creation.skipped.length,
    },
    willCreate: creation.create.slice(0, 25).map((c) => ({
      folder: c.folder.name, clientName: c.clientName, caseNumber: c.caseNumber,
    })),
    createSkipped: creation.skipped.slice(0, 25).map((c) => ({
      folder: c.folder.name, reason: c.reason,
    })),
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

  const { step = 'link' } = await request.json().catch(() => ({}));
  const db = await getSupabaseServerClient();

  if (step === 'link') return linkFolders(db, g.user);
  if (step === 'create') return createFromFolders(db, g.user);
  // `step: 'files'` is gone. Documents are read live from Drive when someone
  // opens them, so there is nothing to index and nothing to go stale.
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

/* ------------------------------------------------------------------ */

/**
 * Create a matter for every case folder that has no case, and link it.
 *
 * The firm's Drive is already a case list — one folder per case, named
 * "Rivera, Marcus 26-033" — so this is a legitimate way to stand the system
 * up. What it CANNOT carry is a folder name's worth of nothing: no SOL, no
 * date of accident, no attorney. Every case made here shows up under Missing
 * Key Dates until the Filevine reports are imported on top, which match by
 * case number and update rather than duplicate.
 *
 * `planCreateFromFolders` decides what is eligible. This function's job is to
 * write it safely.
 */
async function createFromFolders(db, user) {
  const loaded = await loadMatters(db);
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: 500 });

  const listed = await listChildFolders(driveConfig().rootFolderId);
  if (!listed.ok) return NextResponse.json({ error: listed.error }, { status: 502 });

  const { create, skipped } = planCreateFromFolders(listed.folders, loaded.matters);

  const created = [];
  const failed = [];
  const stamp = new Date().toISOString();

  for (const item of create) {
    /*
     * Inserted with the folder ALREADY ATTACHED, in one statement.
     *
     * Creating the matter and then linking it would be two writes with a gap:
     * a failure in between leaves a case with no folder and a folder that the
     * next run sees as unclaimed, so it makes a second case. One insert has no
     * such gap.
     */
    const { data, error } = await db
      .from('matter')
      .insert({
        client_name: item.clientName,
        case_number: item.caseNumber,
        status: 'Open',
        drive_folder_id: item.folder.id,
        drive_folder_name: item.folder.name,
        drive_linked_at: stamp,
        drive_linked_by: user.id,
      })
      .select('id')
      .single();

    if (error) {
      // 23505 is the unique index on case_number. Two people pressing this at
      // once, or a case created between the plan and the write.
      failed.push({
        folder: item.folder.name,
        error: error.code === '23505'
          ? `Case ${item.caseNumber} already exists — nothing was created for this folder.`
          : error.message,
      });
      continue;
    }
    created.push({ id: data.id, caseNumber: item.caseNumber, clientName: item.clientName });
  }

  /*
   * ⚠️ The counter, again.
   *
   * allocate_case_number() reads case_number_counter, not the matters table.
   * These folders run to 26-101; without this the next new intake is handed a
   * number that is now taken and refused by the unique index, and the error
   * points nowhere near this button. Same call importMatters makes.
   */
  if (created.length) {
    const { error } = await db.rpc('reseed_case_number_counter');
    if (error) {
      failed.push({
        folder: '(case-number counter)',
        error: `Cases created, but the counter could not be advanced (${error.message}). `
          + 'Run "select reseed_case_number_counter();" in Supabase before opening a new case.',
      });
    }
  }

  return NextResponse.json({
    ok: failed.length === 0,
    created: created.length,
    skipped: skipped.length,
    skippedReasons: skipped.slice(0, 50).map((s2) => ({ folder: s2.folder.name, reason: s2.reason })),
    failed,
  });
}
