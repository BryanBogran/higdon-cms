/**
 * Supabase implementation of the data layer.
 *
 * Same twenty-one intents the localStorage version exposes, same shapes in
 * and out. `DataProvider` picks one at runtime; no component, page, or route
 * knows which is in use. That was the point of writing the provider as
 * per-record intents rather than whole-collection writes.
 *
 * ── Row shape vs. app shape ──────────────────────────────────────────────
 * The app speaks the prototype's `{ values: {...} }` matter object, where
 * checklist items are nested `{ done, docUrl, note, date }`. Postgres stores
 * the same information as typed columns plus a child table. The mapping lives
 * here and nowhere else, so the schema can be normalized further without the
 * UI noticing.
 *
 * ── A deliberate deviation from the plan ─────────────────────────────────
 * The plan said `generateChainTasks` would move into a Postgres function.
 * It hasn't, and shouldn't yet: that would mean reimplementing malpractice-
 * critical date math in a second language, on a deadline, with none of the
 * 22 tests that currently guard it. Instead the tested JS computes the chain
 * and this module upserts the result. The partial unique index on
 * (matter_id, rule_key) keeps it idempotent, so a half-finished write is
 * repaired by the next matter edit rather than duplicating rows.
 */

import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { FIELDS, DOC_FIELDS, emptyValues, emptyDocValue } from '@/lib/domain/fields';
import { generateChainTasks } from '@/lib/domain/chain';
import { todayInFirmTz } from '@/lib/domain/dates';
import { uploadEmailFiles, signAttachment } from '@/lib/data/email-ingest';

/* ------------------------------------------------------------------ *
 * Column mapping
 * ------------------------------------------------------------------ */

// Scalar FIELDS keys -> matter columns. Anything not listed lands in `extra`.
const COLUMN_OF = {
  clientName: 'client_name',
  caseNumber: 'case_number',
  attorney: 'attorney',
  status: 'status',
  openDate: 'open_date',
  doa: 'doa',
  sol: 'sol',
  opposingCounsel: 'opposing_counsel',
  trialDate: 'trial_date',
  dco: 'dco',
  insurance: 'insurance',
  commercial: 'insurance_class',
  referral: 'referral',
  crossRefCase: 'cross_ref_case',
  settlementAmount: 'settlement_amount',
  settlementDate: 'settlement_date',
  demands: 'demands',
  howSettled: 'how_settled',
  checkStatus: 'check_status',
};

const KEY_OF = Object.fromEntries(Object.entries(COLUMN_OF).map(([k, c]) => [c, k]));

const DATE_COLUMNS = new Set([
  'open_date', 'doa', 'sol', 'trial_date', 'dco', 'settlement_date',
]);
const NUMERIC_COLUMNS = new Set(['settlement_amount']);
const ENUM_COLUMNS = new Set(['status', 'insurance_class']);

/**
 * An empty string is not a date, a number, or an enum member — it is the
 * absence of one. Postgres agrees and will reject `''`, so normalize to null
 * at the boundary rather than letting the error surface as a save failure.
 */
function toColumnValue(column, value) {
  const v = value ?? '';
  if (DATE_COLUMNS.has(column) || NUMERIC_COLUMNS.has(column) || ENUM_COLUMNS.has(column)) {
    return v === '' ? null : v;
  }
  return v === '' ? null : v;
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = parseFloat(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** DB rows -> the `{ [id]: { values } }` shape the app renders from. */
function rowsToMatters(matterRows, checklistRows) {
  const byMatter = {};
  for (const row of checklistRows || []) {
    (byMatter[row.matter_id] ||= {})[row.field_key] = {
      done: Boolean(row.done),
      date: row.occurred_on || '',
      docUrl: row.doc_url || '',
      note: row.note || '',
    };
  }

  const out = {};
  for (const row of matterRows || []) {
    const values = emptyValues();
    for (const [column, key] of Object.entries(KEY_OF)) {
      if (row[column] !== null && row[column] !== undefined) values[key] = String(row[column]);
    }
    for (const [key, item] of Object.entries(byMatter[row.id] || {})) {
      if (DOC_FIELDS.has(key)) values[key] = item;
    }
    for (const [key, value] of Object.entries(row.extra || {})) {
      if (!(key in values)) values[key] = value;
    }
    out[row.id] = {
      values,
      createdAt: row.created_at,
      lastActivityAt: row.last_activity_at,
      archivedAt: row.deleted_at || undefined,
      // The matter's own email address. Staff need to be able to read and copy
      // it -- an intake address nobody can find gets used by nobody.
      intakeSlug: row.intake_slug || '',
      // Written by the Drive sync and read back by the Docs tab and the
      // sync page's "cases without a folder" list. Omitting these was why
      // Docs showed a file count and "no folder linked" at the same time.
      driveFolderId: row.drive_folder_id || '',
      driveFolderName: row.drive_folder_name || '',
    };
  }
  return out;
}

function activityRowToEntry(row) {
  return {
    id: row.id,
    matterId: row.matter_id,
    kind: row.kind,
    title: row.title || '',
    body: row.body || '',
    author: row.author_label || 'Unknown',
    pinned: Boolean(row.pinned),
    mentions: row.mentions || [],
    attachments: row.attachments || [],
    // Email headers. `{}` for every other kind, so the card never branches on
    // whether the column existed when the row was written.
    meta: row.meta || {},
    subject: row.subject || '',
    assignedTo: row.assigned_to,
    dueDate: row.due_date || '',
    completed: Boolean(row.completed),
    source: row.source,
    createdAt: row.created_at,
  };
}

/**
 * A row of the Drive index in the app's shape.
 *
 * `webViewLink` opens Drive's own viewer rather than streaming bytes through
 * this app. That is deliberate: Drive's permissions still apply, and Drive
 * keeps its own record of who opened what. Proxying the file would hand every
 * signed-in user everything the impersonated account can see, and would erase
 * that access log -- on medical records, both are bad trades for a preview.
 */
function documentRowToDoc(row) {
  return {
    id: row.id,
    matterId: row.matter_id,
    provider: row.provider,
    externalId: row.external_id,
    name: row.name,
    mimeType: row.mime_type || '',
    // Google Docs and Sheets have no byte size at all -- null, not zero.
    sizeBytes: row.size_bytes == null ? null : Number(row.size_bytes),
    folderPath: row.folder_path || '',
    webViewLink: row.web_view_link || '',
    createdTime: row.created_time || '',
    modifiedTime: row.modified_time || '',
  };
}

function taskRowToTask(row) {
  return {
    id: row.id,
    matterId: row.matter_id,
    ruleKey: row.rule_key,
    title: row.title,
    note: row.body || '',
    dueDate: row.due_date || '',
    autoDueDate: row.auto_due_date || '',
    manualOverride: Boolean(row.manual_override),
    assignedTo: row.assigned_to || 'Unassigned',
    completed: Boolean(row.completed),
    calendarSynced: Boolean(row.calendar_synced),
    source: row.source,
  };
}

const ok = () => ({ ok: true });
const fail = (error) => ({ ok: false, error: error?.message || String(error) });

/* ------------------------------------------------------------------ *
 * The store
 * ------------------------------------------------------------------ */

export function createSupabaseStore() {
  const db = getSupabaseBrowserClient();

  /** Recompute this matter's auto tasks and upsert them. Idempotent by index. */
  async function regenerateChain(matterId) {
    const [{ data: mRow }, { data: cRows }, { data: existing }] = await Promise.all([
      db.from('matter').select('*').eq('id', matterId).maybeSingle(),
      db.from('matter_checklist_item').select('*').eq('matter_id', matterId),
      db.from('activity').select('*').eq('matter_id', matterId).eq('source', 'auto'),
    ]);
    if (!mRow) return ok();

    const matters = rowsToMatters([mRow], cRows || []);
    const priorById = Object.fromEntries(
      (existing || []).map((r) => [`auto:${matterId}:${r.rule_key}`, taskRowToTask(r)])
    );

    const next = generateChainTasks(matters, priorById);
    const wanted = Object.values(next).filter((t) => t.matterId === matterId);
    const wantedKeys = new Set(wanted.map((t) => t.ruleKey));

    // Retraction, preserving the prototype's rule exactly: an auto task whose
    // trigger disappears is deleted UNLESS completed or manually overridden.
    const toDelete = (existing || []).filter(
      (r) => !wantedKeys.has(r.rule_key) && !r.completed && !r.manual_override
    );
    if (toDelete.length) {
      await db.from('activity').delete().in('id', toDelete.map((r) => r.id));
    }

    if (wanted.length) {
      const payload = wanted.map((t) => ({
        matter_id: matterId,
        kind: 'task',
        source: 'auto',
        rule_key: t.ruleKey,
        title: t.title,
        body: t.note,
        due_date: t.dueDate || null,
        auto_due_date: t.autoDueDate || null,
        manual_override: t.manualOverride,
        assigned_to: t.assignedTo,
        completed: t.completed,
        calendar_synced: t.calendarSynced,
      }));
      const { error } = await db
        .from('activity')
        .upsert(payload, { onConflict: 'matter_id,rule_key', ignoreDuplicates: false });
      if (error) return fail(error);
    }
    return ok();
  }

  return {
    /* -------- load -------- */

    async loadAll() {
      const [matters, checklist, activity, sectionData, sectionRows, profiles, documents, relations] =
        await Promise.all([
        db.from('matter').select('*').order('last_activity_at', { ascending: false }),
        db.from('matter_checklist_item').select('*'),
        db.from('activity').select('*').order('created_at', { ascending: false }),
        db.from('matter_section_data').select('*'),
        db.from('matter_section_row').select('*').order('ordinal'),
        db.from('profile').select('*'),
        // The Drive index. `trashed` rows are excluded: a file deleted in
        // Drive should stop appearing, and the row survives only so the
        // question "was this ever on the file?" stays answerable in SQL.
        //
        // Tolerated as MISSING rather than fatal -- 004_documents.sql may not
        // be applied yet, and the whole app failing to load because the
        // Documents page has no table would be a poor trade.
        db.from('document').select('*').eq('trashed', false).order('modified_time', { ascending: false }),
        // Related cases. Also tolerated as missing until 005_sections.sql runs.
        db.from('matter_relation').select('*'),
      ]);

      const firstError = [matters, checklist, activity, sectionData, sectionRows, profiles]
        .map((r) => r.error)
        .find(Boolean);
      if (firstError) throw firstError;

      const sections = {};
      for (const row of sectionData.data || []) {
        ((sections[row.matter_id] ||= {})[row.section_key] ||= { fields: {}, rows: [] }).fields =
          row.fields || {};
      }
      for (const row of sectionRows.data || []) {
        const bucket = ((sections[row.matter_id] ||= {})[row.section_key] ||= {
          fields: {},
          rows: [],
        });
        bucket.rows.push({ id: row.id, ...(row.data || {}) });
      }

      const all = activity.data || [];
      return {
        matters: rowsToMatters(matters.data, checklist.data),

        // EVERY task row, auto and manual alike. This previously filtered on
        // `source === 'auto'`, so a task created through the Add Task dialog
        // (source 'ui') landed in `activity` instead and disappeared from the
        // Tasks page on reload -- it showed up once from the optimistic update,
        // then vanished, which looks exactly like a save that didn't save.
        tasks: Object.fromEntries(
          all.filter((r) => r.kind === 'task').map((r) => [r.id, taskRowToTask(r)])
        ),

        // The feed is the whole stream, tasks included -- that is how Filevine
        // behaves, and it is why its Feed rail has a Tasks filter at all. One
        // table, two views over it.
        activity: Object.fromEntries(all.map((r) => [r.id, activityRowToEntry(r)])),
        sections,
        team: Object.fromEntries(
          (profiles.data || []).map((p) => [p.display_name, p.email])
        ),
        documents: Object.fromEntries(
          (documents.data || []).map((r) => [r.id, documentRowToDoc(r)])
        ),
        relations: (relations.data || []).map((r) => ({
          id: r.id, fromId: r.from_id, toId: r.to_id, kind: r.kind, note: r.note || '',
        })),
      };
    },

    /* -------- matters -------- */

    async createMatter(input = {}) {
      let caseNumber = input.caseNumber || '';
      if (!caseNumber) {
        const { data } = await db.rpc('allocate_case_number');
        if (data) caseNumber = data;
      }

      const row = {
        client_name: input.clientName || 'Untitled',
        case_number: caseNumber || null,
        status: input.status || 'Open',
        open_date: input.openDate || todayInFirmTz(),
      };
      const { data, error } = await db.from('matter').insert(row).select('id').single();
      if (error) return { ok: false, error: error.message };
      return { ok: true, id: data.id, caseNumber };
    },

    async updateMatterField(matterId, fieldKey, value) {
      if (DOC_FIELDS.has(fieldKey)) {
        return this.setChecklistItem(matterId, fieldKey, value || {});
      }

      const column = COLUMN_OF[fieldKey];
      let error;
      if (column) {
        const v = NUMERIC_COLUMNS.has(column)
          ? toNumber(value)
          : toColumnValue(column, value);
        ({ error } = await db.from('matter').update({ [column]: v }).eq('id', matterId));
      } else {
        // Unknown key -> the JSONB tail, so the UI can add a field before the
        // schema does.
        const { data } = await db.from('matter').select('extra').eq('id', matterId).maybeSingle();
        const extra = { ...(data?.extra || {}), [fieldKey]: value };
        ({ error } = await db.from('matter').update({ extra }).eq('id', matterId));
      }
      if (error) return fail(error);

      // Only the six date fields can move a deadline.
      if (['sol', 'trialDate', 'dco'].includes(fieldKey)) return regenerateChain(matterId);
      return ok();
    },

    async setChecklistItem(matterId, fieldKey, patch) {
      const { data: existing } = await db
        .from('matter_checklist_item')
        .select('*')
        .eq('matter_id', matterId)
        .eq('field_key', fieldKey)
        .maybeSingle();

      const current = existing
        ? { done: existing.done, date: existing.occurred_on || '', docUrl: existing.doc_url || '', note: existing.note || '' }
        : emptyDocValue();
      const merged = { ...current, ...patch };

      const { error } = await db.from('matter_checklist_item').upsert(
        {
          matter_id: matterId,
          field_key: fieldKey,
          done: Boolean(merged.done),
          occurred_on: merged.date || null,
          doc_url: merged.docUrl || null,
          note: merged.note || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'matter_id,field_key' }
      );
      if (error) return fail(error);
      return regenerateChain(matterId);
    },

    async archiveMatter(matterId) {
      const { error } = await db
        .from('matter')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', matterId);
      return error ? fail(error) : ok();
    },

    async unarchiveMatter(matterId) {
      const { error } = await db.from('matter').update({ deleted_at: null }).eq('id', matterId);
      return error ? fail(error) : ok();
    },

    /* -------- tasks -------- */

    async createTask(input = {}) {
      const { data, error } = await db
        .from('activity')
        .insert({
          matter_id: input.matterId || null,
          kind: 'task',
          source: 'ui',
          title: input.title || '',
          body: input.note || '',
          due_date: input.dueDate || null,
          assigned_to: input.assignedTo || 'Unassigned',
        })
        .select('id')
        .single();
      if (error) return { ok: false, error: error.message };
      return { ok: true, id: data.id };
    },

    async updateTask(taskId, patch) {
      const { data: current } = await db
        .from('activity')
        .select('*')
        .eq('id', taskId)
        .maybeSingle();
      if (!current) return { ok: false, error: 'No such task' };

      const update = {};
      if (patch.dueDate !== undefined) update.due_date = patch.dueDate || null;
      if (patch.title !== undefined) update.title = patch.title;
      if (patch.assignedTo !== undefined) update.assigned_to = patch.assignedTo;
      if (patch.completed !== undefined) {
        update.completed = patch.completed;
        update.completed_at = patch.completed ? new Date().toISOString() : null;
      }
      if (patch.calendarSynced !== undefined) update.calendar_synced = patch.calendarSynced;

      // Hand-setting a date on an auto task is the manualOverride path -- the
      // flag the prototype read in three places and no UI ever set.
      if (
        current.source === 'auto' &&
        patch.dueDate !== undefined &&
        patch.dueDate !== current.auto_due_date
      ) {
        update.manual_override = true;
      }

      const { error } = await db.from('activity').update(update).eq('id', taskId);
      return error ? fail(error) : ok();
    },

    async setTaskComplete(taskId, completed) {
      return this.updateTask(taskId, { completed });
    },

    async clearTaskOverride(taskId) {
      const { data: current } = await db
        .from('activity')
        .select('auto_due_date')
        .eq('id', taskId)
        .maybeSingle();
      const { error } = await db
        .from('activity')
        .update({ manual_override: false, due_date: current?.auto_due_date || null })
        .eq('id', taskId);
      return error ? fail(error) : ok();
    },

    async deleteTask(taskId) {
      const { error } = await db.from('activity').delete().eq('id', taskId);
      return error ? fail(error) : ok();
    },

    async bulkSetComplete(taskIds, completed) {
      if (!taskIds?.length) return ok();
      const { error } = await db
        .from('activity')
        .update({ completed, completed_at: completed ? new Date().toISOString() : null })
        .in('id', taskIds);
      return error ? fail(error) : ok();
    },

    /* -------- generic sections -------- */

    async setSectionField(matterId, sectionKey, fieldKey, value) {
      const { data } = await db
        .from('matter_section_data')
        .select('fields')
        .eq('matter_id', matterId)
        .eq('section_key', sectionKey)
        .maybeSingle();
      const fields = { ...(data?.fields || {}), [fieldKey]: value };
      const { error } = await db
        .from('matter_section_data')
        .upsert(
          { matter_id: matterId, section_key: sectionKey, fields, updated_at: new Date().toISOString() },
          { onConflict: 'matter_id,section_key' }
        );
      return error ? fail(error) : ok();
    },

    async addSectionRow(matterId, sectionKey, row = {}) {
      const { count } = await db
        .from('matter_section_row')
        .select('id', { count: 'exact', head: true })
        .eq('matter_id', matterId)
        .eq('section_key', sectionKey);
      const { data, error } = await db
        .from('matter_section_row')
        .insert({ matter_id: matterId, section_key: sectionKey, ordinal: count || 0, data: row })
        .select('id')
        .single();
      if (error) return fail(error);
      return { ok: true, id: data.id };
    },

    async updateSectionRow(matterId, sectionKey, rowId, patch) {
      const { data } = await db
        .from('matter_section_row')
        .select('data')
        .eq('id', rowId)
        .maybeSingle();
      const merged = { ...(data?.data || {}), ...patch };
      delete merged.id;
      const { error } = await db.from('matter_section_row').update({ data: merged }).eq('id', rowId);
      return error ? fail(error) : ok();
    },

    async deleteSectionRow(matterId, sectionKey, rowId) {
      const { error } = await db.from('matter_section_row').delete().eq('id', rowId);
      return error ? fail(error) : ok();
    },

    /* -------- activity -------- */

    async addActivity(input = {}) {
      const { data, error } = await db
        .from('activity')
        .insert({
          matter_id: input.matterId || null,
          kind: input.kind || 'note',
          body: input.body || '',
          author_label: input.author || 'You',
          mentions: input.mentions || [],
          attachments: input.attachments || [],
          assigned_to: input.assignedTo || null,
          due_date: input.dueDate || null,
          source: 'ui',
        })
        .select('id')
        .single();
      if (error) return { ok: false, error: error.message };
      return { ok: true, id: data.id };
    },

    async updateActivity(id, patch) {
      const update = {};
      if (patch.pinned !== undefined) update.pinned = patch.pinned;
      if (patch.body !== undefined) update.body = patch.body;
      if (patch.kind !== undefined) update.kind = patch.kind;
      if (patch.assignedTo !== undefined) update.assigned_to = patch.assignedTo;
      if (patch.dueDate !== undefined) update.due_date = patch.dueDate || null;
      if (patch.completed !== undefined) {
        update.completed = patch.completed;
        update.completed_at = patch.completed ? new Date().toISOString() : null;
      }
      const { error } = await db.from('activity').update(update).eq('id', id);
      return error ? fail(error) : ok();
    },

    async deleteActivity(id) {
      const { error } = await db.from('activity').delete().eq('id', id);
      return error ? fail(error) : ok();
    },

    /**
     * File an email on a matter.
     *
     * Files go up before the row goes in -- see the note in email-ingest.js.
     * An email whose attachments 404 is worse than one that never appeared.
     */
    async addEmail({ matterId, parsed, bytes, normalized, author }) {
      const uploaded = await uploadEmailFiles(db, { matterId, parsed, bytes });
      if (!uploaded.ok) return uploaded;

      const { data, error } = await db
        .from('activity')
        .insert({
          matter_id: matterId,
          kind: 'email',
          subject: normalized.meta.subject || '',
          body: normalized.body,
          meta: normalized.meta,
          dedupe_key: normalized.dedupeKey,
          attachments: uploaded.attachments,
          author_label: author || 'Mail',
          source: 'ui',
        })
        .select('id')
        .single();

      // 23505 is the dedupe index doing its job: this message is already on
      // this matter. Not an error the user needs to see -- the outcome they
      // wanted (the email is on the file) is already true.
      if (error?.code === '23505') {
        const existing = await db
          .from('activity')
          .select('id')
          .eq('dedupe_key', normalized.dedupeKey)
          .maybeSingle();
        return { ok: true, id: existing.data?.id, duplicate: true };
      }
      if (error) return fail(error);
      // Read the row back rather than describing it, so the card on screen is
      // the row in the database -- defaults, triggers and all.
      const { data: row } = await db.from('activity').select('*').eq('id', data.id).single();
      return { ok: true, id: data.id, entry: row ? activityRowToEntry(row) : null };
    },

    /* -------- related cases -------- */

    async addRelation({ fromId, toId, kind, note }) {
      const { data, error } = await db
        .from('matter_relation')
        .insert({ from_id: fromId, to_id: toId, kind: kind || 'Related', note: note || null })
        .select('*')
        .single();
      // 23505 is matter_relation_pair_uq: the same link already exists, made
      // from the other end. The outcome the user wanted is already true.
      if (error?.code === '23505') return { ok: true, duplicate: true };
      if (error) return fail(error);
      return {
        ok: true,
        relation: { id: data.id, fromId: data.from_id, toId: data.to_id, kind: data.kind, note: data.note || '' },
      };
    },

    async removeRelation(id) {
      const { error } = await db.from('matter_relation').delete().eq('id', id);
      return error ? fail(error) : ok();
    },

    /** Mint a short-lived read URL for one stored file. Never cached. */
    async signFile(path) {
      return signAttachment(db, path);
    },

    /** "Assign as Task" — an UPDATE, not an INSERT. Promotes in place. */
    async assignActivityAsTask(id, { assignedTo, dueDate }) {
      return this.updateActivity(id, { kind: 'task', assignedTo, dueDate });
    },

    async saveTeam() {
      // The team directory is now the `profile` table, managed in Supabase.
      return ok();
    },
  };
}
