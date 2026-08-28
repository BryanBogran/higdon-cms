/**
 * The matter section registry — Higdon's own Filevine section list.
 *
 * All fourteen appear in the rail from day one. A section nobody has
 * purpose-built yet still works: the generic engine renders a field group, a
 * repeating row collection, notes, and attachments. Depth gets added where real
 * use justifies it, not up front.
 *
 * `kind` decides who renders it:
 *   'custom'  — a hand-built component with real behavior
 *   'generic' — the section engine, driven by `fields` and `collection` below
 *
 * Filevine configures sections per project type. This stays a flat list until
 * the firm actually needs more than one, but the shape leaves that door open.
 */

export const SECTION_KINDS = { CUSTOM: 'custom', GENERIC: 'generic' };

/**
 * FIELD TYPES
 *
 * The first five came from the prototype. The last four were discovered by
 * capturing Filevine's own API responses (see scripts/extract-sections.mjs) and
 * are not guesses:
 *
 *   contact    — a LINKED PERSON, not a string. Filevine resolves
 *                facilityname / payeename / provider / insurer / insured /
 *                driver / party to one shared contact object carrying
 *                firstName, lastName, phones[], emails[], addresses[],
 *                jobTitle and more. One entity referenced from everywhere,
 *                which is why Parties has to be a real table rather than rows.
 *   datedone   — `{ dateValue, doneDate }`: a deadline with a completion stamp.
 *                Structurally the same idea as the litigation checklist's
 *                yesnoDoc.
 *   attachments— an array of documents hanging off a single ROW, not the matter.
 *   calculated — derived from other fields by a formula. Filevine ships two:
 *                Liens "Reduced By = Amount - Reduction" and Meds
 *                "Reduced By = Amount - Write Offs/Adjustments".
 *
 * `verified: true` on a section means its fields came from the real API
 * capture. Anything without it is still a guess and says so in the UI.
 */

export const SECTIONS = [
  {
    key: 'activity',
    label: 'Activity',
    icon: 'MessageSquare',
    kind: 'custom',
    isDefault: true,
    description: 'Notes, emails, calls, texts, tasks and reminders for this matter.',
  },
  {
    key: 'case-info',
    hidden: true,
    label: 'Case Info',
    icon: 'FolderOpen',
    kind: 'custom',
    description: 'The matter record — the fields the firm tracks in the spreadsheet.',
  },
  {
    key: 'litigation',
    hidden: true,
    label: 'Litigation',
    icon: 'CheckSquare',
    kind: 'custom',
    description: 'The 13-item litigation checklist, each with a date and a document link.',
  },
  {
    key: 'deadline-chain',
    hidden: true,
    label: 'Deadline Chain',
    icon: 'Link2',
    kind: 'custom',
    description: 'Deadlines generated from matter data. Every rule is cited.',
  },
  {
    key: 'call-log',
    hidden: true,
    label: 'Call Log',
    icon: 'Phone',
    kind: 'generic',
    collection: {
      label: 'Calls',
      columns: [
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'who', label: 'Who', type: 'text' },
        { key: 'direction', label: 'Direction', type: 'select', options: ['Incoming', 'Outgoing'] },
        { key: 'summary', label: 'Summary', type: 'textarea' },
      ],
    },
  },
  {
    key: 'intake',
    label: 'Intake',
    icon: 'ClipboardList',
    kind: 'generic',
    fields: [
      { key: 'referredBy', label: 'Referred By', type: 'text' },
      { key: 'intakeDate', label: 'Intake Date', type: 'date' },
      { key: 'caseType', label: 'Case Type', type: 'text' },
      { key: 'incidentDescription', label: 'Incident Description', type: 'textarea' },
      { key: 'injuries', label: 'Injuries', type: 'textarea' },
      { key: 'policeReport', label: 'Police Report #', type: 'text' },
    ],
  },
  {
    key: 'dco',
    label: 'DCO',
    icon: 'CalendarDays',
    kind: 'generic',
    collection: {
      label: 'Docket control deadlines',
      columns: [
        { key: 'deadline', label: 'Deadline', type: 'text' },
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'docUrl', label: 'Order', type: 'url' },
      ],
    },
  },
  {
    key: 'medicals',
    label: 'Medicals',
    icon: 'Pill',
    kind: 'generic',
    verified: true,
    checklistSection: 'Medicals',
    description:
      'Providers, bills and the treatment chronology. Two tables, because the ' +
      'firm tracks a provider-level ledger and a visit-level chronology and ' +
      'they answer different questions.',
    collections: [
      {
      // storageKey, not the section key: these rows were written under
      // `meds` and stay there. Merging two sections must not move a row.
      storageKey: 'meds',
      label: 'Providers, treatment and bills',
      columns: [
        { key: 'provider', label: 'Provider', type: 'contact' },
        { key: 'personbeingtreated', label: 'Person Being Treated', type: 'contact' },
        { key: 'plaintiffstreatmentstatus', label: "Plaintiff's Treatment Status", type: 'select',
          options: ['Treating', 'Treatment Complete', 'Released', 'Gap in Treatment', 'Unknown'] },
        { key: 'datetreatmentstarted', label: 'Treatment Started', type: 'date' },
        { key: 'datetreatmentcompleted', label: 'Treatment Completed', type: 'date' },
        { key: 'amount', label: 'Amount', type: 'money' },
        { key: 'writeoffsadjustments', label: 'Write Offs / Adjustments', type: 'money' },
        // Filevine computes this one. See `calculated` below.
        { key: 'reducedby', label: 'Reduced By', type: 'calculated' },
        { key: 'recordsordereddate', label: 'Records Ordered', type: 'date' },
        { key: 'recordsreceiveddate', label: 'Records Received', type: 'date' },
        { key: 'billsordereddate', label: 'Bills Ordered', type: 'date' },
        { key: 'billsreceiveddate', label: 'Bills Received', type: 'date' },
        { key: 'cptcodes', label: 'CPT Codes', type: 'text' },
        { key: 'injuriesandtreatment', label: 'Injuries and Treatment', type: 'textarea' },
        { key: 'futuretreatment', label: 'Future Treatment', type: 'textarea' },
        { key: 'medicalrecordsummary', label: 'Medical Record Summary', type: 'textarea' },
        { key: 'medicalchronology', label: 'Medical Chronology', type: 'textarea' },
        { key: 'notes', label: 'Notes', type: 'textarea' },
        { key: 'docs', label: 'Documents', type: 'attachments' },
      ],
      total: 'amount',
      // Verbatim from Filevine's sectionMeta: "Reduced By" = A - B where
      // A is Amount and B is Write Offs/Adjustments.
      calculated: {
        reducedby: { formula: 'a-b', inputs: ['amount', 'writeoffsadjustments'] },
      },
      },
      {
        storageKey: 'med-chron',
        label: 'Treatment chronology — one row per date of service',
      columns: [
        { key: 'dateofservice', label: 'Date of Service', type: 'date' },
        { key: 'provider', label: 'Provider', type: 'text' },
        { key: 'facility', label: 'Facility', type: 'text' },
        { key: 'reasonforvisit', label: 'Reason for Visit', type: 'text' },
        { key: 'chiefcomplaint', label: 'Chief Complaint', type: 'textarea' },
        { key: 'historyofthepresentillness', label: 'History of Present Illness', type: 'textarea' },
        { key: 'subjective', label: 'Subjective', type: 'textarea' },
        { key: 'objective', label: 'Objective', type: 'textarea' },
        { key: 'vitalsigns', label: 'Vital Signs', type: 'text' },
        { key: 'painscore', label: 'Pain Score', type: 'text' },
        { key: 'imaging', label: 'Imaging', type: 'textarea' },
        { key: 'testing', label: 'Testing', type: 'textarea' },
        { key: 'assessment', label: 'Assessment', type: 'textarea' },
        { key: 'diagnoses', label: 'Diagnoses', type: 'textarea' },
        { key: 'icd10cmcodes', label: 'ICD-10-CM Codes', type: 'text' },
        { key: 'treatment', label: 'Treatment', type: 'textarea' },
        { key: 'medicationsprescribed', label: 'Medications Prescribed', type: 'textarea' },
        { key: 'plan', label: 'Plan', type: 'textarea' },
        { key: 'followupsorreferralsordered', label: 'Follow-ups / Referrals Ordered', type: 'textarea' },
        { key: 'prognosis', label: 'Prognosis', type: 'textarea' },
        { key: 'reference', label: 'Reference', type: 'url' },
      ],
      },
    ],
  },
  {
    key: 'lost-wages',
    label: 'Lost Wages',
    icon: 'TrendingDown',
    kind: 'generic',
    fields: [
      { key: 'employer', label: 'Employer', type: 'text' },
      { key: 'wageRate', label: 'Wage Rate', type: 'text' },
      { key: 'timeMissed', label: 'Time Missed', type: 'text' },
      { key: 'totalClaimed', label: 'Total Claimed', type: 'money' },
      { key: 'verificationUrl', label: 'Verification', type: 'url' },
    ],
  },
  {
    key: 'liens',
    label: 'Liens',
    icon: 'Bookmark',
    kind: 'generic',
    collection: {
      label: 'Liens',
      columns: [
        { key: 'lienholder', label: 'Lienholder', type: 'text' },
        { key: 'type', label: 'Type', type: 'text' },
        { key: 'amount', label: 'Amount', type: 'money' },
        { key: 'status', label: 'Status', type: 'select', options: ['Open', 'Negotiating', 'Resolved'] },
        { key: 'docUrl', label: 'Document', type: 'url' },
      ],
    },
  },
  {
    key: 'case-summary',
    hidden: true,
    label: 'Case Summary',
    icon: 'FileText',
    kind: 'generic',
    fields: [
      { key: 'summary', label: 'Summary', type: 'textarea' },
      { key: 'liability', label: 'Liability Assessment', type: 'textarea' },
      { key: 'damages', label: 'Damages', type: 'textarea' },
      { key: 'nextSteps', label: 'Next Steps', type: 'textarea' },
    ],
  },
  {
    key: 'expenses',
    label: 'Expenses',
    icon: 'Receipt',
    kind: 'generic',
    verified: true,
    collection: {
      label: 'Case expenses',
      columns: [
        { key: 'dateofinvoice', label: 'Date of Invoice', type: 'date' },
        { key: 'description', label: 'Description', type: 'text' },
        {
          key: 'type',
          label: 'Type',
          type: 'select',
          options: ['Billing Record', 'Medical Record', 'Process Service', 'Postage'],
        },
        { key: 'payeename', label: 'Payee', type: 'contact' },
        { key: 'facilityname', label: 'Facility', type: 'contact' },
        { key: 'invoicenumber', label: 'Invoice #', type: 'text' },
        { key: 'amountofinvoice', label: 'Amount of Invoice', type: 'money' },
        { key: 'amountpaid', label: 'Amount Paid', type: 'money' },
        { key: 'methodofpayment', label: 'Method of Payment', type: 'multiselect',
          options: ['Firm Card', 'Check', 'ACH', 'Cash'] },
        { key: 'cardtype', label: 'Card Type', type: 'select', options: ['Firm Card'] },
        { key: 'paybydate', label: 'Pay By', type: 'datedone' },
        { key: 'notes', label: 'Notes', type: 'textarea' },
        { key: 'documents', label: 'Documents', type: 'attachments' },
      ],
      total: 'amountofinvoice',
    },
  },
  {
    key: 'parties',
    hidden: true,
    label: 'Parties',
    icon: 'Users',
    kind: 'generic',
    verified: true,
    description:
      'Everyone involved in the matter. Each row links to a shared contact record — ' +
      'the same entity Expenses, Meds and Insurance point at.',
    collection: {
      label: 'Parties',
      columns: [
        { key: 'partytype', label: 'Party Type', type: 'select',
          options: ['Plaintiff', 'Defendant', '3rd Party Defendant', 'Witness',
                    'Expert', 'Opposing Counsel', 'Adjuster', 'Provider', 'Other'] },
        { key: 'party', label: 'Party', type: 'contact' },
      ],
    },
  },
  {
    key: 'insurance',
    label: 'Insurance',
    icon: 'Shield',
    kind: 'generic',
    verified: true,
    collection: {
      label: 'Policies',
      columns: [
        { key: 'insurancetype', label: 'Insurance Type', type: 'select',
          options: ['1st Party', '3rd Party', 'UM', 'UIM', 'PIP', 'Med Pay',
                    'Umbrella', 'Health', 'Other'] },
        { key: 'insurer', label: 'Insurer', type: 'contact' },
        { key: 'insured', label: 'Insured', type: 'contact' },
        { key: 'driver', label: 'Driver', type: 'contact' },
        { key: 'claimnumber', label: 'Claim #', type: 'text' },
        { key: 'fileattachment', label: 'File Attachment', type: 'attachments' },
      ],
    },
  },
  {
    key: 'reminders',
    hidden: true,
    label: 'Reminders',
    icon: 'Bell',
    kind: 'generic',
    collection: {
      label: 'Reminders',
      columns: [
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'what', label: 'Reminder', type: 'text' },
        { key: 'who', label: 'For', type: 'text' },
      ],
    },
  },
  {
    key: 'documents',
    hidden: true,
    label: 'Documents',
    icon: 'Files',
    kind: 'generic',
    collection: {
      label: 'Documents',
      columns: [
        { key: 'title', label: 'Title', type: 'text' },
        { key: 'folder', label: 'Folder', type: 'select', options: ['Medicals', 'Pleadings', 'Discovery', 'Correspondence', 'Expenses', 'Other'] },
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'docUrl', label: 'Google Drive Link', type: 'url' },
      ],
    },
  },
  {
    key: 'negotiations',
    label: 'Negotiations',
    icon: 'Handshake',
    kind: 'generic',
    checklistSection: 'Negotiations',
    description: 'Demands, offers and mediation. Fields unverified — from screenshots pending.',
    collection: {
      label: 'Demands and offers',
      columns: [
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'direction', label: 'Type', type: 'select', options: ['Demand', 'Offer', 'Counter'] },
        { key: 'party', label: 'From / To', type: 'text' },
        { key: 'amount', label: 'Amount', type: 'money' },
        { key: 'response', label: 'Response', type: 'textarea' },
        { key: 'docUrl', label: 'Document', type: 'url' },
      ],
    },
  },
  {
    key: 'pleading',
    label: 'Pleading',
    icon: 'Gavel',
    kind: 'generic',
    checklistSection: 'Pleading',
    description: 'Filings and service. Fields unverified — from screenshots pending.',
    collection: {
      label: 'Filings',
      columns: [
        { key: 'filed', label: 'Date Filed', type: 'date' },
        { key: 'title', label: 'Pleading', type: 'text' },
        { key: 'party', label: 'Filed By', type: 'text' },
        { key: 'court', label: 'Court / Cause No.', type: 'text' },
        { key: 'docUrl', label: 'Document', type: 'url' },
      ],
    },
  },
  {
    key: 'depositions',
    label: 'Depositions',
    icon: 'Mic',
    kind: 'generic',
    checklistSection: 'Depositions',
    description: 'Depositions taken and defended. Fields unverified — from screenshots pending.',
    collection: {
      label: 'Depositions',
      columns: [
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'deponent', label: 'Deponent', type: 'contact' },
        { key: 'role', label: 'Role', type: 'select',
          options: ['Plaintiff', 'Defendant', 'Witness', 'Expert', 'Corporate Rep', 'Other'] },
        { key: 'location', label: 'Location', type: 'text' },
        { key: 'transcriptreceived', label: 'Transcript Received', type: 'date' },
        { key: 'errataDue', label: 'Errata Due', type: 'datedone' },
        { key: 'docUrl', label: 'Transcript', type: 'url' },
      ],
    },
  },
  {
    key: 'discovery',
    label: 'Discovery',
    icon: 'Search',
    kind: 'generic',
    checklistSection: 'Discovery',
    description: 'Written discovery served and answered. Fields unverified — from screenshots pending.',
    collection: {
      label: 'Discovery served and received',
      columns: [
        { key: 'served', label: 'Date Served', type: 'date' },
        { key: 'type', label: 'Type', type: 'select',
          options: ['Interrogatories', 'Requests for Production', 'Requests for Admission',
                    'Requests for Disclosure', 'Subpoena', 'Other'] },
        { key: 'direction', label: 'Direction', type: 'select', options: ['Sent', 'Received'] },
        { key: 'party', label: 'Party', type: 'text' },
        // Tex. R. Civ. P. 196/197 give 30 days. `datedone` carries the due
        // date and the day it was actually answered, which is what the
        // deadline chain reads elsewhere.
        { key: 'responseDue', label: 'Response Due', type: 'datedone' },
        { key: 'docUrl', label: 'Document', type: 'url' },
      ],
    },
  },
  {
    key: 'settlement-calculator',
    label: 'Settlement Calculator',
    icon: 'Calculator',
    kind: 'custom',
    description:
      'Gross, fee, expenses and liens to a net figure. Money is computed in ' +
      'integer cents — see lib/domain/settlement.js.',
  },
  {
    key: 'related-cases',
    label: 'Related Cases',
    icon: 'GitBranch',
    kind: 'custom',
    description: 'Other matters connected to this one — same incident, same client, companion suits.',
  },
  {
    key: 'docs',
    label: 'Docs',
    icon: 'Files',
    kind: 'custom',
    description: "The case's Google Drive folder, indexed.",
  },
];

export const SECTION_BY_KEY = Object.fromEntries(SECTIONS.map((s) => [s.key, s]));

/**
 * THE RAIL, IN THE FIRM'S OWN ORDER.
 *
 * Order is data here, not array position. Staff navigate this rail by position
 * all day, so the order is theirs to dictate and ours to follow exactly — and
 * when the screenshots land, changing it is editing this list rather than
 * shuffling two hundred lines of section definitions.
 *
 * A key absent from this list still has a working route and keeps every row it
 * ever had; it simply is not in the rail. That is how Case Info, Litigation and
 * the rest were retired without deleting anything.
 */
export const RAIL_ORDER = [
  'activity',
  'intake',
  'medicals',
  'lost-wages',
  'expenses',
  'insurance',
  'negotiations',
  'pleading',
  'depositions',
  'settlement-calculator',
  'discovery',
  'related-cases',
  'docs',
  // Kept on review, so appended rather than guessed into the middle.
  'liens',
  'dco',
];

/** The visible rail, in order. Anything hidden or unlisted is excluded. */
export const RAIL_SECTIONS = RAIL_ORDER.map((k) => SECTION_BY_KEY[k]).filter(Boolean);

export const DEFAULT_SECTION = SECTIONS.find((s) => s.isDefault)?.key || SECTIONS[0].key;

export function isSectionKey(key) {
  return Object.prototype.hasOwnProperty.call(SECTION_BY_KEY, key);
}
