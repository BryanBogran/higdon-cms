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

  // ---- Litigation Checklist (all yesnoDoc) ----
  { key: 'suitFiled', label: 'Suit Filed', type: 'yesnoDoc', section: 'Litigation Checklist' },
  { key: 'served', label: 'Served', type: 'yesnoDoc', section: 'Litigation Checklist' },
  { key: 'answerFiled', label: 'Answer Filed', type: 'yesnoDoc', section: 'Litigation Checklist' },
  { key: 'plDiscoverySent', label: "Plaintiff's Discovery Sent", type: 'yesnoDoc', section: 'Litigation Checklist' },
  { key: 'plDiscoveryAnswered', label: "Plaintiff's Discovery Answered", type: 'yesnoDoc', section: 'Litigation Checklist' },
  { key: 'defDiscoveryReceived', label: "Defendant's Discovery Received", type: 'yesnoDoc', section: 'Litigation Checklist' },
  { key: 'defDiscoveryAnswered', label: "Defendant's Discovery Answered", type: 'yesnoDoc', section: 'Litigation Checklist' },
  { key: 'recordsOrdered', label: 'Records Ordered', type: 'yesnoDoc', section: 'Litigation Checklist' },
  { key: 'affidavitsFiled', label: 'Affidavits Filed', type: 'yesnoDoc', section: 'Litigation Checklist' },
  { key: 'plDepo', label: "Plaintiff's Deposition", type: 'yesnoDoc', section: 'Litigation Checklist' },
  { key: 'defDepo', label: "Defendant's Deposition", type: 'yesnoDoc', section: 'Litigation Checklist' },
  { key: 'mediation', label: 'Mediation', type: 'yesnoDoc', section: 'Litigation Checklist' },
  { key: 'treatmentDone', label: 'Treatment Done?', type: 'yesnoDoc', section: 'Litigation Checklist' },

  // ---- Financial ----
  { key: 'settlementAmount', label: 'Settlement Amount', type: 'text', section: 'Financial' },
  { key: 'settlementDate', label: 'Settlement Date', type: 'date', section: 'Financial' },
  { key: 'demands', label: 'Demands', type: 'textarea', section: 'Financial' },
  { key: 'howSettled', label: 'How Settled', type: 'text', section: 'Financial' },
  { key: 'checkStatus', label: 'Check Status', type: 'text', section: 'Financial' },
];

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
