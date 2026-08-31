/**
 * The matter field registry.
 *
 * Extracted from prototype/higdon-cms.jsx:10-76. Field definitions, section
 * names, header mapping, and the row factory — the things both the client form
 * and (from Phase 8) the server importer need to agree on.
 *
 * The firm's requirements note says "Paul's uploaded spreadsheet will show
 * everything we need in the case file," so this registry IS the case-file spec,
 * not an implementation detail. Changing it changes the product.
 */

export const SECTIONS = ['Case Info', 'Litigation Checklist', 'Financial'];

/**
 * type:
 *   text | date | select | textarea | yesnoDoc
 *
 * `yesnoDoc` is the shape the requirements note asks for directly — "each thing
 * should have a space to say yes or no when completed, and then have a link
 * upload to upload our Google Drive link with the specific document."
 */
export const FIELDS = [
  // ---- Case Info ----
  { key: 'clientName', label: 'Client Name', type: 'text', section: 'Case Info' },
  { key: 'caseNumber', label: 'Case Number', type: 'text', section: 'Case Info' },
  { key: 'attorney', label: 'Attorney', type: 'text', section: 'Case Info' },
  {
    key: 'status',
    label: 'Status',
    type: 'select',
    options: ['Open', 'Closed', 'Settled - Not Disbursed', 'Default Judgment'],
    section: 'Case Info',
  },
  { key: 'openDate', label: 'Date Opened', type: 'date', section: 'Case Info' },
  { key: 'doa', label: 'DOA', type: 'date', section: 'Case Info' },
  { key: 'sol', label: 'SOL', type: 'date', section: 'Case Info', highStakes: true },
  { key: 'opposingCounsel', label: 'Opposing Counsel', type: 'text', section: 'Case Info' },
  { key: 'trialDate', label: 'Trial Date', type: 'date', section: 'Case Info', highStakes: true },
  { key: 'dco', label: 'DCO', type: 'date', section: 'Case Info', highStakes: true },
  { key: 'insurance', label: 'Insurance', type: 'text', section: 'Case Info' },
  {
    key: 'commercial',
    label: 'Commercial / Personal Lines',
    type: 'select',
    options: ['Commercial', 'Personal Lines', 'Self-Insured / Government', 'Unknown'],
    section: 'Case Info',
  },
  { key: 'referral', label: 'Referral', type: 'text', section: 'Case Info' },
  { key: 'crossRefCase', label: 'Cross-Ref Case', type: 'text', section: 'Case Info' },

  // ---- The former Litigation Checklist, scattered ----
  //
  // These thirteen used to sit in one "Litigation" section. The firm's real
  // rail has no such tab, so each item now lives in the section it belongs to.
  //
  // THIS IS A METADATA CHANGE ONLY. `matter_checklist_item` is keyed by
  // `field_key`, not by section, so nothing moves in the database and no
  // migration is needed -- the same rows simply render somewhere else.
  //
  // `lib/domain/chain.js` reads five of these by key (served, plDiscoverySent,
  // defDiscoveryReceived, recordsOrdered, plDepo) and is completely unaffected.
  { key: 'suitFiled', label: 'Suit Filed', type: 'yesnoDoc', section: 'Pleading' },
  { key: 'served', label: 'Served', type: 'yesnoDoc', section: 'Pleading' },
  { key: 'answerFiled', label: 'Answer Filed', type: 'yesnoDoc', section: 'Pleading' },
  { key: 'plDiscoverySent', label: "Plaintiff's Discovery Sent", type: 'yesnoDoc', section: 'Discovery' },
  { key: 'plDiscoveryAnswered', label: "Plaintiff's Discovery Answered", type: 'yesnoDoc', section: 'Discovery' },
  { key: 'defDiscoveryReceived', label: "Defendant's Discovery Received", type: 'yesnoDoc', section: 'Discovery' },
  { key: 'defDiscoveryAnswered', label: "Defendant's Discovery Answered", type: 'yesnoDoc', section: 'Discovery' },
  /*
   * ORDER IS THE WORKFLOW, and the firm's runs in this order: treatment has to
   * finish before the complete records are worth ordering, and the records have
   * to be in hand before an 18.001 affidavit can be filed on them. A checklist
   * listed out of order invites someone to tick the second box first.
   *
   * `checklistFieldsForSection` filters FIELDS in array order, so this order --
   * and only this order -- is what the Medicals tab renders.
   */
  { key: 'treatmentDone', label: 'Treatment Done?', type: 'yesnoDoc', section: 'Medicals' },
  { key: 'recordsOrdered', label: 'Records Ordered', type: 'yesnoDoc', section: 'Medicals' },
  // ⚠️ Judgement call: an 18.001 affidavit is filed with the court, so Pleading
  // is arguable, but it is an affidavit about the cost and necessity of MEDICAL
  // services and it travels with the records. Move it if the firm disagrees --
  // it is one string.
  { key: 'affidavitsFiled', label: 'Affidavits Filed', type: 'yesnoDoc', section: 'Medicals' },
  { key: 'plDepo', label: "Plaintiff's Deposition", type: 'yesnoDoc', section: 'Depositions' },
  { key: 'defDepo', label: "Defendant's Deposition", type: 'yesnoDoc', section: 'Depositions' },
  { key: 'mediation', label: 'Mediation', type: 'yesnoDoc', section: 'Negotiations' },

  // ---- The former Financial group, likewise ----
  { key: 'settlementAmount', label: 'Settlement Amount', type: 'text', section: 'Settlement Calculator' },
  { key: 'settlementDate', label: 'Settlement Date', type: 'date', section: 'Settlement Calculator' },
  { key: 'demands', label: 'Demands', type: 'textarea', section: 'Negotiations' },
  { key: 'howSettled', label: 'How Settled', type: 'text', section: 'Settlement Calculator' },
  { key: 'checkStatus', label: 'Check Status', type: 'text', section: 'Settlement Calculator' },
];

/**
 * Fields belonging to one section of the rail.
 *
 * Sections ask for their own subset rather than hard-coding key lists, so
 * relocating a field is editing its `section` string here and nothing else.
 */
export function fieldsForSection(sectionLabel) {
  return FIELDS.filter((f) => f.section === sectionLabel);
}

/** Checklist items only — the yesnoDoc subset a section should render. */
export function checklistFieldsForSection(sectionLabel) {
  return FIELDS.filter((f) => f.section === sectionLabel && f.type === 'yesnoDoc');
}

export const FIELD_BY_KEY = Object.fromEntries(FIELDS.map((f) => [f.key, f]));

/** The 13 checklist keys, derived rather than duplicated. */
export const DOC_FIELDS = new Set(FIELDS.filter((f) => f.type === 'yesnoDoc').map((f) => f.key));

/** The six date fields, plus the `date` inside each checklist item. */
export const DATE_FIELDS = FIELDS.filter((f) => f.type === 'date').map((f) => f.key);

/** SOL, trial date, and DCO — a wrong value here is a malpractice event, not a typo. */
export const HIGH_STAKES_FIELDS = FIELDS.filter((f) => f.highStakes).map((f) => f.key);

/** The canonical empty checklist item. */
export function emptyDocValue() {
  return { done: false, docUrl: '', note: '', date: '' };
}

/**
 * The canonical new-matter row factory.
 *
 * Single source of truth on purpose: the prototype hand-duplicated this shape in
 * mail-intake.jsx:160-178 and omitted `date` from every checklist item, which
 * silently broke five of the eight chain rules for any matter created that way.
 */
export function emptyValues() {
  const v = {};
  for (const f of FIELDS) {
    v[f.key] = f.type === 'yesnoDoc' ? emptyDocValue() : '';
  }
  return v;
}

/* ------------------------------------------------------------------ *
 * Spreadsheet header mapping
 * ------------------------------------------------------------------ */

/**
 * [SPREADSHEET_HEADER, fieldKey], sorted longest-first so the most specific
 * header wins. Matching is by PREFIX, which is what tolerates the real sheet's
 * initials and suffixes ("DCO-MA", "Check Status-DD, ML").
 *
 * KNOWN GAP, deliberate: there is no `openDate` entry, because the sheet has no
 * such column. The prototype papered over this by stamping today() on every
 * imported row, which made every historical matter look opened this week and
 * corrupted both "Opened This Month" and every staleness calculation. The Phase
 * 14 importer derives the year from `caseNumber` instead and leaves it null
 * otherwise — null is honest, today() is a lie that looks like data.
 */
export const HEADER_MAP = [
  ['CLIENT NAME', 'clientName'],
  ['CASE NUMBER', 'caseNumber'],
  // Added when the exporter's round-trip test found that a case list this app
  // produced could not be read back by this app: `openDate` had no header
  // here, so a restore silently dropped it. A firm's own spreadsheet is just
  // as likely to carry the column.
  ['DATE OPENED', 'openDate'],
  /*
   * Not a matter field -- planImport uses it to match a row to an existing
   * case and then discards it. It exists so a backup restores EXACTLY: a case
   * with no case number cannot be matched on anything else, so without this
   * every numberless case duplicates on restore. Named distinctively because a
   * firm's own spreadsheet is unlikely to carry a column called this.
   */
  ['INTERNAL ID', 'internalId'],
  ['ATTORNEY', 'attorney'],
  ['STATUS', 'status'],
  ['DOA', 'doa'],
  ['SOL', 'sol'],
  ['OPPOSING COUNSEL', 'opposingCounsel'],
  ['TRIAL DATE', 'trialDate'],
  ['DCO', 'dco'],
  ['SUIT FILED', 'suitFiled'],
  ['SERVED', 'served'],
  ['ANSWER FILED', 'answerFiled'],
  ['ANSWERED', 'answerFiled'],
  ["PLAINTIFF'S DISCOVERY SENT", 'plDiscoverySent'],
  ["PLAINTIFF'S DISCOVERY ANSWERED", 'plDiscoveryAnswered'],
  ["DEFENDANT'S DISCOVERY RECEIVED", 'defDiscoveryReceived'],
  ["DEFENDANT'S DISCOVERY ANSWERED", 'defDiscoveryAnswered'],
  ['TREATMENT DONE?', 'treatmentDone'],
  ['STILL TREATING? YES/NO', 'treatmentDone'],
  ['RECORDS ORDERED', 'recordsOrdered'],
  ['AFFIDAVITS FILED', 'affidavitsFiled'],
  ["PLAINTIFF'S DEPO", 'plDepo'],
  ["DEFENDANT'S DEPO", 'defDepo'],
  ['MEDIATION', 'mediation'],
  ['INSURANCE', 'insurance'],
  ['COMMERCIAL', 'commercial'],
  ['REFERRAL', 'referral'],
  ['CROSS-REF CASE', 'crossRefCase'],
  ['SETTLEMENT AMOUNT', 'settlementAmount'],
  ['SETTLEMENT DATE', 'settlementDate'],
  ['DEMANDS', 'demands'],
  ['HOW SETTLED', 'howSettled'],
  ['CHECK STATUS', 'checkStatus'],

  /*
   * ---- Filevine's own report headers -----------------------------------
   *
   * Taken from the firm's actual 2026-08-30 export, not guessed. Filevine
   * spells the same field several ways across its report templates, and a
   * paralegal re-mapping seven columns by hand on each of eight files is
   * where a Statute of Limitations lands in the wrong row.
   *
   * Every one of these is still overridable on the Columns step. This only
   * moves the default.
   */
  ['NAME', 'clientName'],                        // Referral Source, Service Status
  ['PROJECT NAME', 'clientName'],                // the task reports
  ['STATUTE OF LIMITATIONS', 'sol'],             // "Statute of Limitations: Due"
  ['COURT DATE', 'trialDate'],                   // Case Status / Trial Date Checklist
  ['FIRST PRIMARY', 'attorney'],
  ['PRIMARY ATTORNEY', 'attorney'],              // "Primary Attorney(Last, First)"
  ['REFERRAL SOURCE', 'referral'],
  ['ACTUAL SETTLEMENT DATE', 'settlementDate'],
  ['ACTUAL SETTLEMENT AMOUNT', 'settlementAmount'],
  ['[PLEADINGS]: EARLIEST DATE SERVED', 'served'],

  /*
   * NOT mapped, on purpose, and each for a reason:
   *
   *   Phase              a real column on `matter`, but not in COLUMN_OF, so
   *                      the importer has nowhere to put it. Mapping it would
   *                      make the review screen promise an import that then
   *                      silently drops the value.
   *   Org Name           always "Higdon Lawyers".
   *   Project Type       one template exists.
   *   All NOFA's Filed?  no field of its own yet.
   *   Referred From      a person, not the referral source string.
   */
].sort((a, b) => b[0].length - a[0].length);

export function normalizeHeader(h) {
  return (h || '').toString().trim().toUpperCase().replace(/\s+/g, ' ');
}

/** Longest-prefix match of a spreadsheet header to a field key. '' if none. */
export function guessField(header) {
  const norm = normalizeHeader(header);
  if (!norm) return '';
  for (const [prefix, key] of HEADER_MAP) {
    if (norm.startsWith(prefix)) return key;
  }
  return '';
}

/** Loose yes-detection for messy spreadsheet cells: y, Y, yes, YES, "yes - 3/1". */
export function isYes(raw) {
  return /^\s*y(es)?\b/i.test((raw ?? '').toString());
}
