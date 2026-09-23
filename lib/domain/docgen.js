/**
 * Document generation: which templates exist, and where their values come from.
 *
 * Filevine had this on every section — `Current Template: LOP-.docx` →
 * Generate. `docs/REFERENCE_FILEVINE_AND_RLF.md:664` lists it under "Not
 * built, and visible on the sheets", alongside the four other templates the
 * firm uses: LOP, Plaintiff's Original Petition, Depo Notice, LOR-3rd Party.
 *
 * So the merge engine in `docx.js` knows nothing about cases, and this file
 * knows nothing about Word. Adding the next template is an entry in TEMPLATES
 * plus a .docx — not new code.
 *
 * Pure. No Supabase, no Drive, no clock: `today` is passed in, which is what
 * lets the whole thing be tested in three timezones.
 */

import { fmtLong } from './dates.js';
import {
  displayName, naturalName, phoneByLabel, primaryAddress,
} from './contact.js';

/* ------------------------------------------------------------------ *
 * The templates
 * ------------------------------------------------------------------ */

/**
 * ⚠️ TOKEN NAMES ARE FILEVINE'S, NOT OURS, AND THAT IS DELIBERATE. The firm's
 * .docx files carry `{{meds.provider.address1zip}}` because Filevine put it
 * there. Renaming them would mean editing every template by hand and would
 * break the moment somebody reuses an old copy. Our column is `postal`;
 * reconciling the two names is exactly this table's job.
 *
 * `required` decides whether a blank blocks the document. See the note on
 * `resolveTokens`.
 */
export const TEMPLATES = [
  {
    key: 'med-records-request',
    label: 'Medical Records Request',
    /*
     * What the BUTTON says. The firm calls this one "Med Req" -- it is the
     * name on the file they sent -- and a row action people scan for many
     * times a day should carry their word for it, not the formal title.
     */
    button: 'Med Req',
    file: 'med-req.docx',
    // Which table a Generate button appears on, and where the result lands.
    sectionKey: 'medicals',
    storageKey: 'meds',
    driveFolder: 'Medicals',        // must be one of registry.js's DRIVE_FOLDERS
    targetField: 'recordsrequestsharelink',
    filename: 'Medical Records Request — {{meds.provider.name}}',
    tokens: {
      TODAY_LONG: { source: 'today.long', required: true, label: "Today's date" },
      fullname: { source: 'client.naturalName', required: true, label: 'Client name' },
      ssn: { source: 'client.ssn', required: true, label: 'Client SSN' },
      clientBirthdate: { source: 'client.dob.long', required: true, label: 'Client date of birth' },
      incidentDate: { source: 'matter.doa.long', required: true, label: 'Date of injury' },
      'intake.referredfrom.lastFirst': {
        source: 'section.intake.referredfrom.displayName',
        required: false, label: 'Referred from',
      },
      'meds.provider.name': { source: 'row.provider.name', required: true, label: 'Provider name' },
      'meds.provider.fax1': { source: 'row.provider.phone.Fax', required: true, label: 'Provider fax number' },
      'meds.provider.work1': { source: 'row.provider.phone.Work', required: false, label: 'Provider phone' },
      'meds.provider.address1line1': { source: 'row.provider.address.line1', required: true, label: 'Provider street address' },
      'meds.provider.address1city': { source: 'row.provider.address.city', required: true, label: 'Provider city' },
      'meds.provider.address1state': { source: 'row.provider.address.state', required: true, label: 'Provider state' },
      'meds.provider.address1zip': { source: 'row.provider.address.postal', required: true, label: 'Provider ZIP' },
    },
  },
];

export const TEMPLATE_BY_KEY = Object.fromEntries(TEMPLATES.map((t) => [t.key, t]));

/** Templates offered on one collection's rows. */
export function templatesFor(storageKey) {
  return TEMPLATES.filter((t) => t.storageKey === storageKey);
}

/* ------------------------------------------------------------------ *
 * Reaching a contact
 * ------------------------------------------------------------------ */

/**
 * The contact behind a section cell.
 *
 * A `type: 'contact'` cell holds EITHER `{ id, name }` — picked from the list
 * or created in place — OR a bare name string typed before the cell knew what
 * a contact was. Most existing rows are the second.
 *
 * ⚠️ A BARE NAME IS NEVER RESOLVED BY LOOKING IT UP. `matchContactsByName`
 * exists and its own comment settles why not: "Offered, never applied. Two
 * clients genuinely called Maria Garcia is not a data-entry error." Faxing a
 * records request to the wrong Memorial Hermann is that same mistake with a
 * patient's records attached. The name is reported, the details are not
 * guessed, and the UI offers a one-click link instead.
 */
export function contactFromCell(cell, contacts = {}) {
  if (cell && typeof cell === 'object') {
    const name = String(cell.name || cell.fullname || '').trim();
    const linked = cell.id ? contacts[cell.id] : null;
    if (linked && !linked.deletedAt) return { contact: linked, name: displayName(linked) || name };
    return { contact: null, name };
  }
  return { contact: null, name: String(cell || '').trim() };
}

/** What a contact can be asked for, in one place, for every template. */
function contactValue(contact, path) {
  if (!contact) return '';
  const [head, arg] = path.split('.');
  switch (head) {
    case 'name':
    case 'displayName': return displayName(contact);
    case 'naturalName': return naturalName(contact);
    case 'ssn': return String(contact.ssn || '').trim();
    case 'email': return (contact.emails || []).map((e) => String(e?.value || '').trim()).find(Boolean) || '';
    case 'phone': return phoneByLabel(contact, arg);
    case 'address': return primaryAddress(contact)[arg] || '';
    case 'dob': return arg === 'long' ? fmtLong(contact.dateOfBirth) : String(contact.dateOfBirth || '').trim();
    default: return '';
  }
}

/* ------------------------------------------------------------------ *
 * Resolution
 * ------------------------------------------------------------------ */

/** Why a value is missing, and what a person can do about it. */
const REASONS = {
  'provider-not-linked': (name) =>
    `${name || 'This provider'} is typed as text, not linked to a contact record. Link it to fill in the address and fax number.`,
  'no-client-contact': () =>
    'This case has no client contact linked, so there is nowhere to read the SSN and date of birth from.',
  empty: (name) => `${name || 'The record'} has no value recorded for this.`,
};

/**
 * Every token a template needs, resolved from the case.
 *
 * @param {string} templateKey
 * @param {object} ctx
 * @param {object} ctx.matter    `{ values: {...}, clientContactId }`
 * @param {object} ctx.sections  `{ [sectionKey]: { fields, rows } }`
 * @param {object} ctx.row       the collection row this document is for
 * @param {object} ctx.contacts  id → contact
 * @param {string} ctx.today     "YYYY-MM-DD" in the firm's zone, injected
 * @returns {{ values: object, missing: Array<{token,label,reason,why,required}> }}
 *
 * ⚠️ MISSING IS REPORTED, NEVER PAPERED OVER. A records request with a blank
 * fax line is not a slightly worse letter, it is a letter that goes nowhere —
 * and the delay is invisible until somebody wonders why a provider never
 * answered. The caller refuses on any `required` miss.
 */
export function resolveTokens(templateKey, ctx = {}) {
  const template = TEMPLATE_BY_KEY[templateKey];
  if (!template) throw new Error(`Unknown document template: ${templateKey}`);

  const { matter = {}, sections = {}, row = {}, contacts = {}, today = '' } = ctx;
  const values = {};
  const missing = [];

  const client = matter.clientContactId ? contacts[matter.clientContactId] : null;
  const liveClient = client && !client.deletedAt ? client : null;

  for (const [token, spec] of Object.entries(template.tokens)) {
    const [value, reason, subject] = resolveOne(spec.source, {
      matter, sections, row, contacts, today, client: liveClient,
    });

    values[token] = value;
    if (value) continue;

    missing.push({
      token,
      label: spec.label || token,
      required: Boolean(spec.required),
      reason,
      why: (REASONS[reason] || REASONS.empty)(subject),
    });
  }

  return { values, missing };
}

/** One `source` string → `[value, reasonIfEmpty, subjectForTheMessage]`. */
function resolveOne(source, ctx) {
  const [head, ...rest] = String(source).split('.');
  const path = rest.join('.');

  if (head === 'today') {
    return [path === 'long' ? fmtLong(ctx.today) : ctx.today, 'empty', 'The system clock'];
  }

  if (head === 'matter') {
    const [key, format] = rest;
    const raw = ctx.matter?.values?.[key] ?? '';
    return [format === 'long' ? fmtLong(raw) : String(raw || '').trim(), 'empty', 'This case'];
  }

  if (head === 'client') {
    /*
     * ⚠️ SSN and date of birth live on the CONTACT, never on the matter --
     * `supabase/008_contacts.sql` put them there and redacts both from the
     * audit log. `matter.client_contact_id` is nullable and was deliberately
     * never backfilled, so on most cases there is simply nothing to read, and
     * that is the single commonest reason a document will not generate.
     */
    if (!ctx.client) {
      // The client's name is still recoverable from the matter itself.
      if (path === 'naturalName') {
        const fallback = String(ctx.matter?.values?.clientName || '').trim();
        if (fallback) return [fallback, 'empty', 'This case'];
      }
      return ['', 'no-client-contact', ''];
    }
    return [contactValue(ctx.client, path), 'empty', displayName(ctx.client)];
  }

  if (head === 'section') {
    const [sectionKey, fieldKey, ...detail] = rest;
    const cell = ctx.sections?.[sectionKey]?.fields?.[fieldKey];
    const { contact, name } = contactFromCell(cell, ctx.contacts);
    const want = detail.join('.') || 'displayName';
    if (!contact) return [want === 'displayName' || want === 'name' ? name : '', name ? 'provider-not-linked' : 'empty', name];
    return [contactValue(contact, want), 'empty', displayName(contact)];
  }

  if (head === 'row') {
    const [column, ...detail] = rest;
    const cell = ctx.row?.[column];
    const want = detail.join('.') || 'name';

    // A plain column, not a contact one.
    if (!detail.length && (cell === null || typeof cell !== 'object')) {
      return [String(cell || '').trim(), 'empty', 'This row'];
    }

    const { contact, name } = contactFromCell(cell, ctx.contacts);
    if (!contact) {
      // The name still resolves from a bare string; nothing else can.
      if (want === 'name' || want === 'displayName') return [name, 'empty', 'This row'];
      return ['', name ? 'provider-not-linked' : 'empty', name];
    }
    return [contactValue(contact, want), 'empty', displayName(contact)];
  }

  return ['', 'empty', ''];
}

/**
 * The document's filename, from the template's pattern.
 *
 * Sanitised here rather than at the call site, because the pieces come from
 * data somebody typed: a provider entered as "Memorial Hermann / Southwest"
 * would otherwise ask Drive to make a folder.
 */
export function documentFilename(templateKey, values = {}, { date = '' } = {}) {
  const template = TEMPLATE_BY_KEY[templateKey];
  if (!template) throw new Error(`Unknown document template: ${templateKey}`);

  const filled = template.filename.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (m, k) => values[k] || '');
  const clean = filled
    .replace(/[\\/:*?"<>|]/g, ' ')          // illegal in a filename, and in Drive
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    // A token that resolved to nothing leaves its separator behind, and
    // "Medical Records Request —.docx" reads as a bug to whoever opens the
    // folder. Trim the punctuation the pattern used to join the parts.
    .replace(/^[\s.\u2013\u2014,;:-]+|[\s.\u2013\u2014,;:-]+$/g, '')
    .slice(0, 180)
    .trim();

  const stem = clean || template.label;
  return `${stem}${date ? ` ${date}` : ''}.docx`;
}
