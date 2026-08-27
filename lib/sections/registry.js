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
    label: 'Case Info',
    icon: 'FolderOpen',
    kind: 'custom',
    description: 'The matter record — the fields the firm tracks in the spreadsheet.',
  },
  {
    key: 'litigation',
    label: 'Litigation',
    icon: 'CheckSquare',
    kind: 'custom',
    description: 'The 13-item litigation checklist, each with a date and a document link.',
  },
  {
    key: 'deadline-chain',
    label: 'Deadline Chain',
    icon: 'Link2',
    kind: 'custom',
    description: 'Deadlines generated from matter data. Every rule is cited.',
  },
  {
    key: 'med-chron',
    label: 'Med Chron Data',
    icon: 'BarChart3',
    kind: 'generic',
    collection: {
      label: 'Treatment entries',
      columns: [
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'provider', label: 'Provider', type: 'text' },
        { key: 'type', label: 'Type', type: 'text' },
        { key: 'summary', label: 'Summary', type: 'textarea' },
        { key: 'docUrl', label: 'Document', type: 'url' },
      ],
    },
  },
  {
    key: 'call-log',
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
    key: 'meds',
    label: 'Meds',
    icon: 'Pill',
    kind: 'generic',
    collection: {
      label: 'Providers and bills',
      columns: [
        { key: 'provider', label: 'Provider', type: 'text' },
        { key: 'billed', label: 'Billed', type: 'money' },
        { key: 'paid', label: 'Paid', type: 'money' },
        { key: 'recordsOrdered', label: 'Records Ordered', type: 'date' },
        { key: 'docUrl', label: 'Records', type: 'url' },
      ],
    },
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
    collection: {
      label: 'Case expenses',
      columns: [
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'description', label: 'Description', type: 'text' },
        { key: 'category', label: 'Category', type: 'text' },
        { key: 'amount', label: 'Amount', type: 'money' },
        { key: 'docUrl', label: 'Receipt', type: 'url' },
      ],
      total: 'amount',
    },
  },
  {
    key: 'parties',
    label: 'Parties',
    icon: 'Users',
    kind: 'generic',
    collection: {
      label: 'Parties and contacts',
      columns: [
        { key: 'name', label: 'Name', type: 'text' },
        { key: 'role', label: 'Role', type: 'select', options: ['Client', 'Defendant', 'Opposing Counsel', 'Adjuster', 'Witness', 'Expert', 'Provider', 'Other'] },
        { key: 'firm', label: 'Firm / Company', type: 'text' },
        { key: 'phone', label: 'Phone', type: 'tel' },
        { key: 'email', label: 'Email', type: 'email' },
      ],
    },
  },
  {
    key: 'insurance',
    label: 'Insurance',
    icon: 'Shield',
    kind: 'generic',
    collection: {
      label: 'Policies',
      columns: [
        { key: 'carrier', label: 'Carrier', type: 'text' },
        { key: 'coverageType', label: 'Coverage', type: 'select', options: ['Liability', 'UM', 'UIM', 'PIP', 'Med Pay', 'Umbrella', 'Other'] },
        { key: 'policyNumber', label: 'Policy #', type: 'text' },
        { key: 'limits', label: 'Limits', type: 'text' },
        { key: 'adjuster', label: 'Adjuster', type: 'text' },
        { key: 'adjusterPhone', label: 'Adjuster Phone', type: 'tel' },
        { key: 'claimNumber', label: 'Claim #', type: 'text' },
      ],
    },
  },
  {
    key: 'reminders',
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
];

export const SECTION_BY_KEY = Object.fromEntries(SECTIONS.map((s) => [s.key, s]));

export const DEFAULT_SECTION = SECTIONS.find((s) => s.isDefault)?.key || SECTIONS[0].key;

export function isSectionKey(key) {
  return Object.prototype.hasOwnProperty.call(SECTION_BY_KEY, key);
}
