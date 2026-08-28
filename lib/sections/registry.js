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
    uploadFolder: 'Correspondence',
    label: 'Intake',
    icon: 'ClipboardList',
    kind: 'generic',
    verified: true,
    description: 'The intake interview. Eight groups, in the order the call runs.',
    groups: [
      {
        title: 'Intake',
        fields: [
          { key: 'incidentdate', label: 'Incident Date', type: 'date' },
          { key: 'medicaremedicaid', label: 'Medicare/Medicaid', type: 'yesnounknown' },
          { key: 'uimcarrier', label: 'UIM Carrier', type: 'text' },
          { key: 'commercialinsurance', label: 'Commercial Insurance', type: 'yesnounknown' },
          { key: 'dateofintake', label: 'Date of Intake', type: 'date' },
          { key: 'personperformingintake', label: 'Person Performing Intake', type: 'contact' },
          { key: 'sol', label: 'SOL', type: 'date' },
          { key: 'referralsource', label: 'Referral Source', type: 'select',
            options: ['Unknown', 'Former Client', 'Attorney Referral', 'Family/Friend', 'Internet', 'Advertising', 'Other'] },
          { key: 'referredfrom', label: 'Referred From', type: 'contact' },
          { key: 'accidenttype', label: 'Accident Type', type: 'select',
            options: ['Unknown', 'Motor Vehicle', '18-Wheeler', 'Premises', 'Dog Bite', 'Slip and Fall', 'Wrongful Death', 'Other'] },
          { key: 'descriptionofaccident', label: 'Description of Accident', type: 'textarea' },
        ],
      },
      {
        title: 'Personal Info',
        fields: [
          { key: 'spouse', label: 'Spouse', type: 'contact' },
          { key: 'children', label: 'Children', type: 'yesnounknown' },
          { key: 'education', label: 'Education', type: 'text' },
        ],
      },
      {
        title: 'Accident Information',
        fields: [
          { key: 'timeofaccident', label: 'Time of Accident', type: 'text' },
          { key: 'locationofaccident', label: 'Location of Accident', type: 'text' },
          { key: 'authoritiescalled', label: 'Were Authorities called to the scene?', type: 'yesnounknown' },
          { key: 'transportedbyambulance', label: 'Were you transported in an ambulance?', type: 'yesnounknown' },
          { key: 'wenttohospital', label: 'Did you go to the Hospital?', type: 'yesnounknown' },
          { key: 'witnesses', label: 'Witnesses', type: 'yesnounknown' },
          { key: 'policereport', label: 'Police Report', type: 'yesnounknown' },
          { key: 'policereportdocs', label: 'PoliceReport', type: 'attachments', full: true },
          { key: 'drivername', label: 'Driver Name', type: 'text' },
          { key: 'driverinsurance', label: 'Driver Insurance', type: 'text' },
          { key: 'driverpolicylimits', label: 'Driver Policy Limits', type: 'text' },
        ],
      },
      {
        title: 'Injuries',
        fields: [
          { key: 'injuriessustained', label: 'Injuries Sustained', type: 'multiselect',
            options: ['Head', 'Neck', 'Back', 'Shoulder', 'Arm', 'Hand', 'Hip', 'Knee', 'Leg', 'Foot', 'Internal', 'Psychological'] },
          { key: 'describeinjuries', label: 'Describe Injuries Sustained / Pain Complaints', type: 'textarea' },
          { key: 'providersseentodate', label: 'Medical Providers Seen to Date', type: 'textarea', full: true },
          { key: 'picturestakenofinjuries', label: 'Pictures taken of Injuries', type: 'yesnounknown' },
        ],
      },
      {
        title: 'Priors',
        fields: [
          { key: 'priorinjuries', label: 'Prior Injuries', type: 'textarea' },
          { key: 'priorclaims', label: 'Prior Claims w/ Attorney and $$ Received', type: 'textarea' },
          { key: 'priorlawsuits', label: 'Prior Lawsuits w/ Attorney and $$ Received', type: 'textarea' },
        ],
      },
      {
        title: 'Economic Damages',
        fields: [
          { key: 'employmentstatus', label: 'Employment Status', type: 'select',
            options: ['Unknown', 'Employed', 'Self-Employed', 'Unemployed', 'Retired', 'Student'] },
          { key: 'lostwagesnotes', label: 'Lost Wages Notes', type: 'textarea' },
          { key: 'concurrentemployment', label: 'Concurrent Employment', type: 'yesnounknown' },
          { key: 'taxreturns', label: 'Tax Returns', type: 'attachments', full: true },
        ],
      },
      {
        title: 'Non Economic Damages',
        fields: [
          { key: 'cannolongerdo', label: 'Things Client can no longer do at all', type: 'textarea' },
          { key: 'canbutwithpain', label: 'Can, but with pain / not as well', type: 'textarea' },
          { key: 'lossofenjoyment', label: "Loss of life's enjoyment", type: 'textarea' },
          { key: 'healthhistory', label: 'Health History — Overall Health (surgeries, broken bones, etc.)', type: 'textarea' },
        ],
      },
      {
        title: 'Wrap-Up',
        fields: [
          { key: 'subsequentaccidents', label: 'Subsequent Accidents', type: 'yesnounknown' },
          { key: 'personalobservation', label: 'Personal Observation / Take', type: 'textarea' },
          { key: 'gameplan', label: 'Game Plan Discussed with Client', type: 'textarea' },
          { key: 'reviewsocialmediapolicy', label: 'Review Social Media Letter/Policy', type: 'yesnounknown' },
          { key: 'socialmediaconcerns', label: 'Additional Thoughts/Concerns Raised about Social Media', type: 'textarea' },
          { key: 'socialmediahandles', label: "All Social Media Platforms and User ID's", type: 'textarea' },
        ],
      },
      {
        title: 'Additional Info',
        fields: [
          { key: 'additionalinfo', label: 'Additional Info', type: 'textarea' },
          { key: 'additionaldocs', label: 'Additional Docs', type: 'attachments', full: true },
          { key: 'leadstatus', label: 'Lead Status', type: 'select',
            options: ['Unknown', 'Signed', 'Pending', 'Declined', 'Referred Out'] },
        ],
      },
    ],
  },
  {
    key: 'dco',
    uploadFolder: 'Pleadings',
    label: 'DCO',
    icon: 'CalendarDays',
    kind: 'generic',
    collection: {
      label: 'Docket control deadlines',
      columns: [
        { key: 'deadline', label: 'Deadline', type: 'text' },
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'docUrl', label: 'Order', type: 'driveFile' },
      ],
    },
  },
  {
    key: 'medicals',
    uploadFolder: 'Medical Records',
    label: 'Medicals',
    icon: 'Pill',
    kind: 'generic',
    verified: true,
    checklistSection: 'Medicals',
    description: 'One row per provider. Bills and records retrieval tracked per provider, not per case.',
    collections: [
      {
        // storageKey, not the section key: these rows were written under
        // `meds` and stay there. Merging two sections must not move a row.
        storageKey: 'meds',
        label: 'Providers, treatment and bills',
        columns: [
          { key: 'provider', label: 'Provider', type: 'contact' },
          { key: 'personbeingtreated', label: 'Person Being Treated', type: 'contact' },
          { key: 'amount', label: 'Amount', type: 'money' },
          { key: 'paymentsorreductions', label: 'Payments or Reductions?', type: 'yesnounknown' },
          { key: 'datetreatmentstarted', label: 'Date treatment started', type: 'date' },
          { key: 'datetreatmentcompleted', label: 'Date treatment completed', type: 'date' },
          { key: 'datesofservice', label: 'List all Date(s) of Service', type: 'textarea' },
          // Was a `url` asking for a pasted Drive link. Dropping the file
          // here uploads it into the case's Medical Records folder and links
          // it, which is the same outcome without the seven manual steps.
          { key: 'recordsrequestsharelink', label: 'Medical Records Request', type: 'driveFile' },
          { key: 'providersaccountnumber', label: "Provider's Account Number", type: 'text' },
          { key: 'plaintiffstreatmentstatus', label: "Plaintiff's treatment status", type: 'select',
            options: ['Unknown', 'Treating', 'Treatment Complete', 'Released', 'Gap in Treatment'] },
          { key: 'billsordereddate', label: 'Bills ordered date', type: 'date' },
          { key: 'billsreceiveddate', label: 'Bills Received Date', type: 'date' },
          { key: 'recordsordereddate', label: 'Records ordered date', type: 'date' },
          { key: 'recordsreceiveddate', label: 'Records received date', type: 'date' },
          { key: 'recordsinvoicereceived', label: 'Records Invoice Received', type: 'yesnounknown' },
          { key: 'notes', label: 'Notes', type: 'textarea' },
          { key: 'medicalrecordsandbills', label: 'Medical Records and Bills', type: 'attachments' },
        ],
        total: 'amount',
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
    uploadFolder: 'Correspondence',
    label: 'Lost Wages',
    icon: 'TrendingDown',
    kind: 'generic',
    verified: true,
    fields: [
      { key: 'totallostwages', label: 'Total Lost Wages in Dollars', type: 'money' },
      { key: 'typeofwages', label: 'Type of Wages', type: 'select',
        options: ['Unknown', 'Hourly', 'Salary', 'Self-Employed', 'Commission', 'Tips'] },
      { key: 'amountoftimemissed', label: 'Amount of Time Missed', type: 'text' },
      { key: 'rateperhour', label: 'Rate per Hour', type: 'money' },
      { key: 'typeofwork', label: 'Type of Work', type: 'text' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
      { key: 'adddocs', label: 'Add Docs', type: 'attachments', full: true },
    ],
  },
  {
    key: 'liens',
    uploadFolder: 'Correspondence',
    label: 'Liens',
    icon: 'Bookmark',
    kind: 'generic',
    verified: true,
    collection: {
      label: 'Liens',
      columns: [
        { key: 'lienholder', label: 'Lien Holder', type: 'contact' },
        { key: 'amount', label: 'Amount', type: 'money' },
        { key: 'recoveryagency', label: 'Recovery Agency', type: 'contact' },
        { key: 'recoveryagent', label: 'Recovery Agent', type: 'contact' },
        { key: 'letterofrepsentdate', label: 'Letter of Rep Sent Date', type: 'date' },
        { key: 'noticedatereceived', label: 'Notice Date Received', type: 'date' },
        { key: 'finallienreceiveddate', label: 'Final Lien Received Date', type: 'date' },
        { key: 'reduction', label: 'Reduction', type: 'money' },
        { key: 'notes', label: 'Notes', type: 'textarea' },
        { key: 'documents', label: 'Documents', type: 'attachments' },
      ],
      total: 'amount',
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
    uploadFolder: 'Expenses',
    label: 'Expenses',
    icon: 'Receipt',
    kind: 'generic',
    verified: true,
    collection: {
      label: 'Case expenses',
      columns: [
        { key: 'type', label: 'Type', type: 'select',
          options: ['Unknown', 'Billing Record', 'Medical Record', 'Process Service', 'Postage', 'Filing Fee', 'Parking', 'Expert', 'Court Reporter'] },
        { key: 'dateofinvoice', label: 'Date of Invoice', type: 'date' },
        { key: 'invoicenumber', label: 'Invoice Number', type: 'text' },
        { key: 'amountofinvoice', label: 'Amount of Invoice', type: 'money' },
        { key: 'payeename', label: 'Payee Name', type: 'contact' },
        { key: 'facilityname', label: 'Facility Name', type: 'contact' },
        { key: 'paybydate', label: 'Pay By Date', type: 'datedone' },
        { key: 'amountpaid', label: 'Amount Paid', type: 'money' },
        { key: 'recordsreceived', label: 'Records Received?', type: 'yesnounknown' },
        { key: 'methodofpayment', label: 'Method of Payment', type: 'multiselect',
          options: ['Firm Card', 'Check', 'ACH', 'Cash'] },
        { key: 'description', label: 'Description', type: 'text' },
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
    uploadFolder: 'Correspondence',
    label: 'Insurance',
    icon: 'Shield',
    kind: 'generic',
    verified: true,
    description: 'One row per policy. Three adjuster slots, because PD, BI and PIP are rarely the same person.',
    collection: {
      label: 'Policies',
      columns: [
        { key: 'insurancetype', label: 'Insurance Type', type: 'select',
          options: ['Unknown', '1st Party', '3rd Party', 'UM', 'UIM', 'PIP', 'Med Pay', 'Umbrella', 'Health'] },
        { key: 'liability', label: 'Liability', type: 'select',
          options: ['Unknown', 'Accepted', 'Denied', 'Disputed', 'Under Investigation'] },
        { key: 'insurancecompany', label: 'Insurance Company', type: 'contact' },
        { key: 'pdadjuster', label: 'PD Adjuster', type: 'contact' },
        { key: 'biadjuster', label: 'BI Adjuster', type: 'contact' },
        { key: 'pipadjuster', label: 'PIP Adjuster', type: 'contact' },
        { key: 'insured', label: 'Insured', type: 'contact' },
        { key: 'driver', label: 'Driver', type: 'contact' },
        { key: 'claimnumber', label: 'Claim Number', type: 'text' },
        { key: 'policynumber', label: 'Policy Number', type: 'text' },
        { key: 'policylimits', label: 'Policy Limits', type: 'text' },
        { key: 'estimatedoneformva', label: 'Estimate Done for MVA', type: 'yesnounknown' },
        { key: 'notes', label: 'Notes', type: 'textarea' },
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
    uploadFolder: 'Correspondence',
    label: 'Negotiations',
    icon: 'Handshake',
    kind: 'generic',
    verified: true,
    checklistSection: 'Negotiations',
    collection: {
      label: 'Offers and demands',
      columns: [
        { key: 'offerdemandsettled', label: 'Offer/Demand/Settled', type: 'select',
          options: ['Unknown', 'Demand', 'Offer', 'Counter', 'Settled'] },
        { key: 'amount', label: 'Amount', type: 'money' },
        { key: 'policylimitdemand', label: 'Policy Limit Demand', type: 'text' },
        { key: 'tofrom', label: 'To/From', type: 'contact' },
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'notes', label: 'Notes', type: 'textarea' },
        { key: 'docs', label: 'Docs', type: 'attachments' },
      ],
      total: 'amount',
    },
  },
  {
    key: 'pleading',
    uploadFolder: 'Pleadings',
    label: 'Pleading',
    icon: 'Gavel',
    kind: 'generic',
    verified: true,
    checklistSection: 'Pleading',
    collection: {
      label: 'Pleadings',
      columns: [
        { key: 'pleadingname', label: 'Pleading Name', type: 'text' },
        { key: 'pleadingtype', label: 'Pleading type', type: 'select',
          options: ['Unknown', 'Petition', 'Answer', 'Motion', 'Response', 'Reply', 'Order', 'Notice'] },
        { key: 'drafter', label: 'Drafter', type: 'contact' },
        { key: 'dateserved', label: 'Date Served', type: 'date' },
        { key: 'responder', label: 'Responder', type: 'contact' },
        { key: 'responsedate', label: 'Response Date', type: 'date' },
        { key: 'replier', label: 'Replier', type: 'contact' },
        { key: 'replydate', label: 'Reply Date', type: 'date' },
        { key: 'hearingdate', label: 'Hearing Date', type: 'date' },
        { key: 'ordertendered', label: 'Order Tendered', type: 'yesnounknown' },
        { key: 'notes', label: 'Notes', type: 'textarea' },
        { key: 'documents', label: 'Documents', type: 'attachments' },
      ],
    },
  },
  {
    key: 'depositions',
    uploadFolder: 'Discovery',
    label: 'Depositions',
    icon: 'Mic',
    kind: 'generic',
    verified: true,
    checklistSection: 'Depositions',
    collection: {
      label: 'Depositions',
      columns: [
        { key: 'deponent', label: 'Deponent', type: 'contact' },
        { key: 'datescheduled', label: 'Date Scheduled', type: 'date' },
        { key: 'time', label: 'Time', type: 'text' },
        { key: 'location', label: 'Location', type: 'contact' },
        { key: 'ourclientexpert', label: 'Our Client/Expert?', type: 'yesnounknown' },
        { key: 'depositiontaken', label: 'Deposition Taken', type: 'yesnounknown' },
        { key: 'defatty', label: 'Def Atty', type: 'contact' },
        { key: 'generalnotes', label: 'General Notes', type: 'textarea' },
        { key: 'redflags', label: 'Red Flags', type: 'textarea' },
        { key: 'documents', label: 'Documents', type: 'attachments' },
      ],
    },
  },
  {
    key: 'discovery',
    uploadFolder: 'Discovery',
    label: 'Discovery',
    icon: 'Search',
    kind: 'generic',
    verified: true,
    checklistSection: 'Discovery',
    description: 'Filevine calls this Written Disc. One row per request served or received.',
    collection: {
      label: 'Written discovery',
      columns: [
        { key: 'inout', label: 'In/Out', type: 'select', options: ['Unknown', 'In', 'Out'] },
        { key: 'type', label: 'Type', type: 'select',
          options: ['Unknown', 'Interrogatories', 'Requests for Production', 'Requests for Admission',
                    'Requests for Disclosure', 'Subpoena'] },
        { key: 'party', label: 'Party', type: 'contact' },
        { key: 'title', label: 'Title', type: 'text' },
        { key: 'drafter', label: 'Drafter', type: 'contact' },
        // Tex. R. Civ. P. 196/197 give 30 days. `datedone` carries the due date
        // and the day it was actually answered.
        { key: 'response', label: 'Response', type: 'datedone' },
        { key: 'done', label: 'Done', type: 'yesnounknown' },
        { key: 'notes', label: 'Notes', type: 'textarea' },
        { key: 'discoverydocuments', label: 'Discovery Documents', type: 'attachments' },
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
