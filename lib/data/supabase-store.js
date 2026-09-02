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
import { CASE_NUMBER_RE } from '@/lib/domain/case-number';
import { uploadEmailFiles, signAttachment } from '@/lib/data/email-ingest';

/* ------------------------------------------------------------------ *
 * Column mapping
 * ------------------------------------------------------------------ */

// Scalar FIELDS keys -> matter columns. Anything not listed lands in `extra`.
export const COLUMN_OF = {
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

export const KEY_OF = Object.fromEntries(Object.entries(COLUMN_OF).map(([k, c]) => [c, k]));

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
export function toColumnValue(column, value) {
  const v = value ?? '';
  if (DATE_COLUMNS.has(column) || NUMERIC_COLUMNS.has(column) || ENUM_COLUMNS.has(column)) {
    return v === '' ? null : v;
  }
  return v === '' ? null : v;
}

export function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = parseFloat(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** DB rows -> the `{ [id]: { values } }` shape the app renders from. */
export function rowsToMatters(matterRows, checklistRows) {
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

export function activityRowToEntry(row) {
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

export function taskRowToTask(row) {
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

/* ------------------------------------------------------------------ *
 * Contacts
 * ------------------------------------------------------------------ */

const CONTACT_COLUMNS = {
  kind: 'kind',
  firstName: 'first_name', middleName: 'middle_name', lastName: 'last_name',
  prefix: 'prefix', suffix: 'suffix', nickname: 'nickname',
  companyName: 'company_name', department: 'department', jobTitle: 'job_title',
  phones: 'phones', emails: 'emails', addresses: 'addresses',
  salutation: 'salutation', primaryLanguage: 'primary_language',
  dateOfBirth: 'date_of_birth', deceased: 'deceased',
  canText: 'can_text', canRemarket: 'can_remarket', isMinor: 'is_minor',
  gender: 'gender', maritalStatus: 'marital_status',
  driverLicense: 'driver_license', fiduciary: 'fiduciary', notes: 'notes',
  clientEntityId: 'client_entity_id', ssn: 'ssn', tags: 'tags',
};

const CONTACT_KEY_OF = Object.fromEntries(
  Object.entries(CONTACT_COLUMNS).map(([k, c]) => [c, k])
);

const CONTACT_JSON = new Set(['phones', 'emails', 'addresses', 'tags']);
const CONTACT_BOOL = new Set(['deceased', 'can_text', 'can_remarket', 'is_minor']);
const CONTACT_DATE = new Set(['date_of_birth']);

export function contactRowToContact(row) {
  const out = { id: row.id };
  for (const [column, key] of Object.entries(CONTACT_KEY_OF)) {
    const v = row[column];
    if (CONTACT_JSON.has(column)) out[key] = v || [];
    else if (CONTACT_BOOL.has(column)) out[key] = Boolean(v);
    else out[key] = v ?? '';
  }
  out.createdAt = row.created_at;
  out.updatedAt = row.updated_at;
  out.deletedAt = row.deleted_at || undefined;
  return out;
}

/** Only keys actually present are written, so a partial patch cannot blank. */
export function contactToRow(contact = {}) {
  const row = {};
  for (const [key, column] of Object.entries(CONTACT_COLUMNS)) {
    if (!(key in contact)) continue;
    const v = contact[key];
    if (CONTACT_JSON.has(column)) row[column] = v || [];
    else if (CONTACT_BOOL.has(column)) row[column] = Boolean(v);
    // An empty string is not a date. Postgres agrees, loudly.
    else if (CONTACT_DATE.has(column)) row[column] = v === '' || v == null ? null : v;
    else row[column] = v === '' ? null : v;
  }
  return row;
}

const ok = () => ({ ok: true });
const fail = (error) => ({ ok: false, error: error?.message || String(error) });

/* ------------------------------------------------------------------ *
 * The store
 * ------------------------------------------------------------------ */

/**
 * @param {object} [client] Supabase client to use. Defaults to the browser
 *   client. Passed explicitly by tests, which is the only way this module can
 *   be exercised without a live project -- and it is the largest file in the
 *   app, so "cannot be exercised" was not an acceptable state for it.
 */
export function createSupabaseStore(client) {
  const db = client || getSupabaseBrowserClient();

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
      const [matters, checklist, activity, sectionData, sectionRows, profiles, relations, contacts] =
        await Promise.all([
        db.from('matter').select('*').order('last_activity_at', { ascending: false }),
        db.from('matter_checklist_item').select('*'),
        db.from('activity').select('*').order('created_at', { ascending: false }),
        db.from('matter_section_data').select('*'),
        db.from('matter_section_row').select('*').order('ordinal'),
        db.from('profile').select('*'),
        // Related cases. Tolerated as missing until 005_sections.sql runs.
        db.from('matter_relation').select('*'),
        // Contacts. Tolerated as missing until 008_contacts.sql runs, so the
        // app keeps working on a database that has not had it applied yet.
        db.from('contact').select('*'),
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
        relations: (relations.data || []).map((r) => ({
          id: r.id, fromId: r.from_id, toId: r.to_id, kind: r.kind, note: r.note || '',
        })),
        // `contacts.error` is not fatal: a database that has not had
        // 008_contacts.sql applied should still open every case it has.
        contacts: Object.fromEntries(
          (contacts.data || []).filter((c) => !c.deleted_at)
            .map((c) => [c.id, contactRowToContact(c)])
        ),
      };
    },

    /* -------- contacts -------- */

    async createContact(contact = {}) {
      const { data, error } = await db
        .from('contact')
        .insert(contactToRow(contact))
        .select('*')
        .single();
      if (error) return fail(error);
      return { ok: true, id: data.id, contact: contactRowToContact(data) };
    },

    async updateContact(id, patch = {}) {
      const row = contactToRow(patch);
      if (!Object.keys(row).length) return ok();
      row.updated_at = new Date().toISOString();
      const { data, error } = await db
        .from('contact').update(row).eq('id', id).select('*').single();
      if (error) return fail(error);
      return { ok: true, contact: contactRowToContact(data) };
    },

    /**
     * Point a matter at a contact.
     *
     * `client_name` is written alongside, not replaced. Every list, export and
     * search in the app reads that column, and a matter whose client is only
     * reachable through a join would go nameless everywhere until each of them
     * is taught about contacts. The contact is the record; the column is a
     * denormalised label kept in step.
     */
    async linkClientContact(matterId, contactId, displayName) {
      const { error } = await db
        .from('matter')
        .update({
          client_contact_id: contactId || null,
          ...(displayName ? { client_name: displayName } : {}),
        })
        .eq('id', matterId);
      return error ? fail(error) : ok();
    },

    /* -------- matters -------- */

    async createMatter(input = {}) {
      let caseNumber = String(input.caseNumber || '').trim();

      /*
       * A number typed by a person is checked HERE as well as by the check
       * constraint, because the constraint's message is
       * `violates check constraint "case_number_format"` and nobody should
       * have to read that to learn they typed 26-33.
       */
      const manual = Boolean(caseNumber);
      if (manual && !CASE_NUMBER_RE.test(caseNumber)) {
        return { ok: false, error: 'A case number is two digits, a hyphen, then three — 26-033.' };
      }

      if (!caseNumber) {
        const { data, error } = await db.rpc('allocate_case_number');
        if (error) {
          /*
           * Swallowing this created a case with no number and said nothing.
           * One of those is a nuisance; sixty of them during an import is a
           * file you cannot tell apart from the next one.
           */
          return { ok: false, error: `Could not allocate a case number: ${error.message}` };
        }
        if (data) caseNumber = data;
      }

      const row = {
        client_name: input.clientName || 'Untitled',
        case_number: caseNumber || null,
        status: input.status || 'Open',
        open_date: input.openDate || todayInFirmTz(),
      };
      const { data, error } = await db.from('matter').insert(row).select('id').single();
      if (error) {
        // 23505 on this table is the partial unique index on case_number.
        if (error.code === '23505') {
          return { ok: false, error: `${caseNumber} is already used by another case.` };
        }
        return { ok: false, error: error.message };
      }

      /*
       * ⚠️ A NUMBER TYPED BY HAND MUST MOVE THE COUNTER.
       *
       * `allocate_case_number` reads `case_number_counter`, not the matters
       * table. Type 26-033 while the counter sits at 26-028 and the next five
       * automatic numbers are fine -- the sixth is 26-033, which the unique
       * index rejects, and the person who hits it did nothing wrong.
       *
       * `reseed_case_number_counter()` raises each year's counter to the
       * highest number actually in use (`greatest`, so it never goes
       * backwards) and is granted to `authenticated`. Idempotent.
       *
       * Not fatal if it fails: the case exists and is correct. The cost is a
       * collision later, which surfaces as a clear message rather than a bad
       * write, so refusing the whole creation over it would be the worse
       * trade.
       */
      if (manual) await db.rpc('reseed_case_number_counter');

      return { ok: true, id: data.id, caseNumber };
    },

    /**
     * Write a reviewed import plan. See lib/domain/import.js for how the plan
     * is built; by the time it arrives here a person has read it.
     *
     * Two rules hold, and both exist because this runs against a case list the
     * firm is rebuilding from fragments:
     *
     *   A partial file never blanks a field. Only keys actually present in the
     *   row are written, so importing a spreadsheet that carries SOLs but no
     *   trial dates cannot erase the trial dates entered last week.
     *
     *   A checklist row can never attach to the wrong client. Matters with a
     *   case number go in as one bulk insert and are read back BY case number,
     *   which is an exact mapping. Rows with no case number have nothing to
     *   read back by, so they are inserted one at a time to get an unambiguous
     *   id. Relying on the order a bulk insert returns would be faster and is
     *   probably correct -- "probably" is not good enough when the cost of
     *   being wrong is a medical checklist filed under another client.
     *
     * Rows with no case number are left with none rather than being allocated
     * one. An invented number that matches nothing in the firm's paper file is
     * worse than an empty column someone fills in later.
     */
    async importMatters(entries = []) {
      const created = [];
      const updated = [];
      const failed = [];
      const idByRow = new Map();

      const toRow = (values) => {
        const row = {};
        for (const [key, value] of Object.entries(values)) {
          if (DOC_FIELDS.has(key)) continue;
          const column = COLUMN_OF[key];
          if (!column) continue;
          row[column] = NUMERIC_COLUMNS.has(column)
            ? toNumber(value)
            : toColumnValue(column, value);
        }
        return row;
      };

      const creates = entries.filter((e) => e.action === 'create');
      const numbered = creates.filter((e) => String(e.values.caseNumber || '').trim());
      const unnumbered = creates.filter((e) => !String(e.values.caseNumber || '').trim());

      if (numbered.length) {
        const rows = numbered.map((e) => ({ ...toRow(e.values), status: e.values.status || 'Open' }));
        const { error } = await db.from('matter').insert(rows);
        if (error) {
          for (const e of numbered) failed.push({ rowIndex: e.rowIndex, error: error.message });
        } else {
          const wanted = numbered.map((e) => String(e.values.caseNumber).trim());
          const { data: back, error: readErr } = await db
            .from('matter')
            .select('id, case_number')
            .in('case_number', wanted);
          if (readErr) {
            for (const e of numbered) failed.push({ rowIndex: e.rowIndex, error: readErr.message });
          } else {
            const byCase = new Map((back || []).map((r) => [String(r.case_number), r.id]));
            for (const e of numbered) {
              const id = byCase.get(String(e.values.caseNumber).trim());
              if (id) { idByRow.set(e.rowIndex, id); created.push(id); }
              else failed.push({ rowIndex: e.rowIndex, error: 'Inserted but could not be read back' });
            }
          }
        }
      }

      for (const e of unnumbered) {
        const { data, error } = await db
          .from('matter')
          .insert({ ...toRow(e.values), status: e.values.status || 'Open' })
          .select('id')
          .single();
        if (error) failed.push({ rowIndex: e.rowIndex, error: error.message });
        else { idByRow.set(e.rowIndex, data.id); created.push(data.id); }
      }

      for (const e of entries.filter((x) => x.action === 'update')) {
        const row = toRow(e.values);
        if (Object.keys(row).length) {
          const { error } = await db.from('matter').update(row).eq('id', e.matterId);
          if (error) { failed.push({ rowIndex: e.rowIndex, error: error.message }); continue; }
        }
        idByRow.set(e.rowIndex, e.matterId);
        updated.push(e.matterId);
      }

      // Checklist items, one upsert for the whole file.
      const items = [];
      for (const e of entries) {
        const matterId = idByRow.get(e.rowIndex);
        if (!matterId) continue;
        for (const [fieldKey, item] of Object.entries(e.checklist || {})) {
          items.push({
            matter_id: matterId,
            field_key: fieldKey,
            done: Boolean(item.done),
            occurred_on: item.date || null,
            note: item.note || null,
            updated_at: new Date().toISOString(),
          });
        }
      }
      if (items.length) {
        const { error } = await db
          .from('matter_checklist_item')
          .upsert(items, { onConflict: 'matter_id,field_key' });
        if (error) failed.push({ rowIndex: null, error: `Checklist items: ${error.message}` });
      }

      /*
       * ⚠️ RAISE THE COUNTER PAST WHAT WAS JUST IMPORTED.
       *
       * `allocate_case_number()` reads `case_number_counter`, not the matters
       * table. Import the firm's 359 cases — which run up to 26-101 — while
       * the counter sits at 0, and the very next new intake is handed 26-001,
       * which the unique index rejects. So does 26-002, and so on for a
       * hundred tries. The person hitting it did nothing wrong and the error
       * points nowhere near the import that caused it.
       *
       * `reseed_case_number_counter()` raises each year to the highest number
       * actually in use (`greatest`, so it never moves backwards) and is
       * idempotent. Same call `createMatter` makes after a hand-typed number,
       * for the same reason.
       *
       * Not fatal if it fails: the cases are written and correct, and the
       * cost is a collision on the next new matter rather than bad data.
       * Reported in `failed` so it is not silent.
       */
      if (created.length || updated.length) {
        const { error } = await db.rpc('reseed_case_number_counter');
        if (error) {
          failed.push({
            rowIndex: null,
            error: `Cases imported, but the case-number counter could not be advanced `
              + `(${error.message}). The next new case may be refused as a duplicate — `
              + `run "select reseed_case_number_counter();" in Supabase.`,
          });
        }
      }

      /*
       * Recompute the deadline chains for the cases whose import actually
       * carried a chain-driving date.
       *
       * WITHOUT THIS THE IMPORT LOOKS BROKEN. updateMatterField regenerates
       * whenever sol, trialDate or dco changes, but importMatters writes those
       * columns directly and used not to -- so bringing in the firm's 268
       * statutes of limitations would have stored all 268 dates and produced
       * ZERO deadline tasks. Staff would open a case, see the SOL filled in and
       * the Deadlines tab empty, and reasonably conclude the engine was broken.
       *
       * Only rows that carried one of those fields, so a settlement-only or
       * referral-only file does not walk all 344 cases for nothing.
       */
      const CHAIN_FIELDS = ['sol', 'trialDate', 'dco'];
      const needChain = [...new Set(
        entries
          .filter((e) => CHAIN_FIELDS.some((k) => String(e.values?.[k] ?? '').trim()))
          .map((e) => idByRow.get(e.rowIndex))
          .filter(Boolean),
      )];

      /*
       * Bounded, not sequential and not all at once. Each regenerateChain is
       * four round trips, so 268 of them in series is minutes of staring at a
       * spinner -- and Promise.all over the whole set opens 268 concurrent
       * connections, which Supabase will start refusing partway through and
       * leave the chains half-written.
       */
      const CHAIN_CONCURRENCY = 6;
      for (let i = 0; i < needChain.length; i += CHAIN_CONCURRENCY) {
        const batch = needChain.slice(i, i + CHAIN_CONCURRENCY);
        const results = await Promise.all(batch.map(async (id) => {
          try {
            return await regenerateChain(id);
          } catch (err) {
            return fail(err);
          }
        }));
        for (const r of results) {
          /*
           * Non-fatal, like the counter reseed above: the dates themselves are
           * written and correct, and only the derived tasks are missing. Say so
           * rather than failing an import that mostly worked.
           */
          if (r && r.ok === false) {
            failed.push({
              rowIndex: null,
              error: `A case imported, but its deadlines could not be recalculated `
                + `(${r.error || 'unknown error'}). Opening that case and re-saving its `
                + `SOL will redo them.`,
            });
          }
        }
      }

      return { ok: failed.length === 0, created: created.length, updated: updated.length, failed };
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
      /*
       * The local store has always refused a key that is not a checklist
       * field; this one did not, so the same call succeeded against one
       * backend and failed against the other -- which defeats the point of
       * two implementations of one interface.
       *
       * Without the guard the row is written and then ignored: rowsToMatters
       * filters reads by DOC_FIELDS, so the value never appears anywhere, and
       * a junk row sits in matter_checklist_item being audited forever.
       */
      if (!DOC_FIELDS.has(fieldKey)) {
        return { ok: false, error: `${fieldKey} is not a checklist item` };
      }

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

    /**
     * Permanent deletion. Not archive — the row goes.
     *
     * Goes through the `delete_matter` function rather than a plain
     * `.delete()` for three reasons the client cannot do itself:
     *
     *   it refuses a matter under legal_hold (a BEFORE DELETE trigger
     *     enforces that too, so the invariant does not depend on this call);
     *   it records WHY, which the automatic audit triggers cannot capture.
     *
     * The audit history is NOT removed. An earlier version tried and the
     * database refused it, correctly: a log that can be erased by the same
     * button that erases the case proves nothing about either.
     *
     * The Drive folder is NOT touched. Nothing in Postgres should reach into
     * Google and bin a client's medical records because someone tidied a
     * case list. See supabase/011_delete_matter.sql.
     */
    async deleteMatter(matterId, { reason = '' } = {}) {
      const { data, error } = await db.rpc('delete_matter', {
        p_matter_id: matterId,
        p_reason: reason || null,
      });
      if (error) {
        /*
         * restrict_violation is the legal-hold refusal. Passed through as
         * written, because the function's message names the case number and
         * says what to do; wrapping it in "Could not delete" would bury the
         * one sentence that matters.
         */
        return { ok: false, error: error.message };
      }
      return { ok: true, ...(data || {}) };
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
