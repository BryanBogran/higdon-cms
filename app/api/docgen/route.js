/**
 * Generate a document from a template and file it in the case's Drive folder.
 *
 * The firm's records clerk asked for the medical-records-request letter they
 * used in Filevine. Four more templates follow; this route is written for all
 * of them, and which one is being made is a key, never a path.
 *
 * ── What this refuses to take from the caller ────────────────────────────
 *
 * The body carries `{ matterId, templateKey, rowId }` and nothing else. In
 * particular NOT the token values.
 *
 * ⚠️ AN ENDPOINT THAT ACCEPTED TOKEN VALUES WOULD BE A SERVICE FOR PRINTING
 * ARBITRARY TEXT ON A LAW FIRM'S LETTERHEAD, addressed to a hospital, signed
 * by the firm. Every value is read here, from the database, under the signed-in
 * user's own credentials. The client says which case and which row; it never
 * says what the letter says.
 *
 * The same applies to the folder (resolved by NAME and then checked for
 * ancestry, exactly as /api/drive/upload-url does), the filename (built from
 * the template's pattern and sanitised), and the template itself (an
 * allow-list lookup — a caller-supplied path would be a read primitive against
 * every file `files@` can see).
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import {
  getSupabaseServerClient, getCurrentUser, isServerSupabaseConfigured,
} from '@/lib/supabase/server';
import {
  isDriveConfigured, driveConfig, uploadFile, folderTree, resolveSubfolder,
} from '@/lib/google/drive';
import { isWithinTree } from '@/lib/google/drive-paths';
import { TEMPLATE_BY_KEY, resolveTokens, documentFilename } from '@/lib/domain/docgen';
import { mergeDocx, findSurvivingTokens } from '@/lib/domain/docx';
import { todayInFirmTz } from '@/lib/domain/dates';
import { contactRowToContact, rowsToMatters } from '@/lib/data/supabase-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Templates ship with the code.
 *
 * Versioned alongside the mapping that fills them, so a token added to the
 * .docx and a token added to the manifest move together — there is a test that
 * fails if they drift. Serving them from Drive so the firm can edit letterhead
 * themselves is a reasonable later want; it buys a runtime failure mode, and
 * if it lands the fallback must be announced rather than silent. A letter on
 * last year's letterhead that everyone believes is on this year's is a real
 * harm.
 */
function templatePath(file) {
  return path.join(process.cwd(), 'lib', 'templates', file);
}

export async function POST(request) {
  if (!isServerSupabaseConfigured()) {
    return NextResponse.json({ error: 'The database is not configured.' }, { status: 503 });
  }
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  if (!isDriveConfigured()) {
    return NextResponse.json({ error: 'Google Drive is not connected.' }, { status: 503 });
  }
  if (!driveConfig().impersonate) {
    return NextResponse.json(
      {
        error:
          'Saving a generated document needs GOOGLE_IMPERSONATE_USER. A service account owns no Drive storage, so a file it would own is refused. See docs/GOOGLE_DRIVE_SETUP.md, Level 2.',
        needsImpersonation: true,
      },
      { status: 503 },
    );
  }

  const { matterId, templateKey, rowId, allowMissing } = await request.json().catch(() => ({}));
  if (!matterId || !templateKey || !rowId) {
    return NextResponse.json({ error: 'matterId, templateKey and rowId are required.' }, { status: 400 });
  }

  const template = TEMPLATE_BY_KEY[templateKey];
  if (!template) return NextResponse.json({ error: 'Unknown document template.' }, { status: 400 });

  /*
   * The USER's client, not the service role. RLS then applies, so somebody who
   * cannot see a case cannot generate a letter about it either.
   */
  const db = await getSupabaseServerClient();

  const { data: matterRow, error: matterError } = await db
    .from('matter').select('*').eq('id', matterId).is('deleted_at', null).single();
  if (matterError) return NextResponse.json({ error: matterError.message }, { status: 500 });
  if (!matterRow?.drive_folder_id) {
    return NextResponse.json({ error: 'This case has no Drive folder linked.' }, { status: 400 });
  }

  /*
   * ⚠️ ALL THREE PREDICATES. A rowId belonging to a different case would
   * otherwise pull that case's provider into this letter and file it in this
   * case's folder — a patient's records requested from the wrong hospital,
   * stored where nobody would think to look for the mistake.
   */
  const { data: row, error: rowError } = await db
    .from('matter_section_row')
    .select('id, data')
    .eq('id', rowId)
    .eq('matter_id', matterId)
    .eq('section_key', template.storageKey)
    .single();
  if (rowError || !row) {
    return NextResponse.json({ error: 'That row is not on this case.' }, { status: 404 });
  }

  const { data: sectionRows } = await db
    .from('matter_section_data').select('section_key, fields').eq('matter_id', matterId);
  const sections = {};
  for (const s of sectionRows || []) sections[s.section_key] = { fields: s.fields || {}, rows: [] };

  /*
   * Only the contacts this document could name: the client, and whatever the
   * row and the sections point at. One query rather than the whole directory.
   */
  const wanted = new Set();
  const noteId = (cell) => { if (cell && typeof cell === 'object' && cell.id) wanted.add(cell.id); };
  if (matterRow.client_contact_id) wanted.add(matterRow.client_contact_id);
  for (const cell of Object.values(row.data || {})) noteId(cell);
  for (const s of Object.values(sections)) for (const cell of Object.values(s.fields)) noteId(cell);

  const contacts = {};
  if (wanted.size) {
    const { data: contactRows } = await db
      .from('contact').select('*').in('id', [...wanted]).is('deleted_at', null);
    for (const c of contactRows || []) contacts[c.id] = contactRowToContact(c);
  }

  const matter = rowsToMatters([matterRow], [])[matterId];
  const today = todayInFirmTz();
  const { values, missing } = resolveTokens(templateKey, {
    matter, sections, row: { id: row.id, ...(row.data || {}) }, contacts, today,
  });

  /*
   * ⚠️ REFUSE RATHER THAN SEND A HOLLOW LETTER.
   *
   * A records request with a blank fax line, for a patient with no date of
   * birth, is not a slightly worse document. The provider rejects it or never
   * receives it, and nothing surfaces until somebody wonders weeks later why
   * the records never came. Loud and early is cheaper every time.
   *
   * `allowMissing` is reached only by a second click, after the person has
   * been shown exactly what is blank. They know things the database does not
   * — they may be mailing rather than faxing — and a tool that cannot be
   * overridden simply gets worked around in Word, which loses the audit trail,
   * the filing and the consistency all at once.
   */
  const blocking = missing.filter((m) => m.required);
  if (blocking.length && !allowMissing) {
    return NextResponse.json(
      { error: 'Some details this letter needs are missing.', missing: blocking },
      { status: 422 },
    );
  }

  let merged;
  try {
    const bytes = new Uint8Array(await readFile(templatePath(template.file)));
    merged = await mergeDocx(bytes, (token) => values[token], { blankUnresolved: Boolean(allowMissing) });
  } catch (e) {
    return NextResponse.json({ error: e.message || 'That template could not be read.' }, { status: 500 });
  }

  /*
   * Read our own output back before anything leaves. The failure this engine
   * was written to prevent was silent — a finished-looking letter with
   * `{{meds.provider.fax1}}` printed in the address block. Ten lines turns the
   * whole class into an error nobody can miss.
   */
  const survived = await findSurvivingTokens(merged.bytes);
  if (survived.length) {
    return NextResponse.json(
      { error: `The document still had unfilled placeholders (${survived.join(', ')}), so nothing was saved.` },
      { status: 500 },
    );
  }

  const root = matterRow.drive_folder_id;
  const sub = await resolveSubfolder(root, template.driveFolder);
  if (!sub.ok) return NextResponse.json({ error: sub.error }, { status: 502 });

  const tree = await folderTree(root);
  if (!tree.ok) return NextResponse.json({ error: tree.error }, { status: 502 });
  if (!isWithinTree(sub.folderId, root, tree.byId)) {
    return NextResponse.json({ error: 'That folder is not inside this case.' }, { status: 403 });
  }

  /*
   * The bytes pass through this server, which deliberately contradicts the
   * note on createUploadSession. That note is about the BROWSER uploading
   * scanned records and video depositions; this is a 50 KB letter generated
   * here, with nothing to stream from anywhere. Left unsaid, somebody will
   * eventually "fix" it into a resumable session for no benefit.
   */
  const uploaded = await uploadFile({
    folderId: sub.folderId,
    name: documentFilename(templateKey, values, { date: today }),
    mimeType: DOCX_MIME,
    bytes: merged.bytes,
  });
  if (!uploaded.ok) return NextResponse.json({ error: uploaded.error }, { status: 502 });

  const ref = {
    id: uploaded.file.id,
    name: uploaded.file.name,
    url: uploaded.file.webViewLink || `https://drive.google.com/file/d/${uploaded.file.id}/view`,
  };

  /*
   * ⚠️ THE LINK IS WRITTEN HERE, NOT BY THE BROWSER.
   *
   * If the client stored it and the tab closed in between, the letter would
   * sit in Drive with the case field empty — an orphan nobody knows exists,
   * and the clerk generates a second one. Same "store first, report second"
   * ordering the bug-report route argues for.
   *
   * update_section_row patches one key rather than writing the whole row, so a
   * colleague editing another cell at the same moment is not clobbered.
   */
  const { error: patchError } = await db.rpc('update_section_row', {
    p_row_id: rowId,
    p_patch: { [template.targetField]: ref },
  });
  if (patchError) {
    return NextResponse.json(
      { error: `The letter was saved to Drive but the case field was not updated: ${patchError.message}`, file: ref },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    file: ref,
    field: template.targetField,
    replaced: merged.replaced,
    missing: missing.filter((m) => !m.required || allowMissing),
  });
}
