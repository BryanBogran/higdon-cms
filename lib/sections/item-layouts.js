/**
 * Card and editor layouts for the wide section tables, keyed by storage key.
 *
 * Shape, per table:
 *   noun    what one row is called, for "+ Add provider"
 *   left    the card's main field -- what the row IS (the provider)
 *   right   the second main field -- usually the amount or the date
 *   status  optional, shown on the card as a pill (treatment status)
 *   groups  headed groups for the editor, IN PAIR ORDER: the editor is a
 *           two-column grid, so consecutive half-width fields sit side by side.
 *           Put pairs next to each other -- Started / Completed, Bills ordered
 *           / Bills received -- as Filevine's own section sheets do
 *           (docs/REFERENCE_FILEVINE_AND_RLF.md §10). Notes, attachments and
 *           multi-selects take the full width automatically.
 *
 * ⚠️ Every column of a table must be listed exactly once here, header fields
 * included. lib/sections/layout.test.js fails if one is missing or unknown --
 * a field left out would still be reachable (it falls into a "More" group),
 * but it would be in the wrong place, and "More" is a safety net, not a design.
 *
 * Keys only. Labels, types and options stay in registry.js.
 */
export const ITEM_LAYOUTS = {
  meds: {
    noun: 'provider',
    left: 'provider',
    right: 'amount',
    status: 'plaintiffstreatmentstatus',
    groups: [
      { title: 'Treatment', fields: ['personbeingtreated', 'providersaccountnumber', 'datetreatmentstarted', 'datetreatmentcompleted', 'datesofservice'] },
      { title: 'Bills & records', fields: ['billsordereddate', 'billsreceiveddate', 'recordsordereddate', 'recordsreceiveddate', 'recordsinvoicereceived', 'nofafiled'] },
      { title: 'Documents', fields: ['lopsharelink', 'recordsrequestsharelink', 'medicalrecordsandbills', 'bills'] },
      { title: 'Notes', fields: ['notes'] },
    ],
  },

  'med-chron': {
    noun: 'visit',
    left: 'provider',
    right: 'dateofservice',
    groups: [
      { title: 'Visit', fields: ['facility', 'reasonforvisit', 'vitalsigns', 'painscore', 'chiefcomplaint', 'historyofthepresentillness'] },
      { title: 'Examination', fields: ['subjective', 'objective', 'imaging', 'testing'] },
      { title: 'Assessment', fields: ['icd10cmcodes', 'assessment', 'diagnoses'] },
      { title: 'Plan', fields: ['treatment', 'medicationsprescribed', 'plan', 'followupsorreferralsordered', 'prognosis'] },
      { title: 'Source', fields: ['reference'] },
    ],
  },

  liens: {
    noun: 'lien',
    left: 'lienholder',
    right: 'amount',
    groups: [
      { title: 'Recovery', fields: ['recoveryagency', 'recoveryagent'] },
      { title: 'Dates & reduction', fields: ['letterofrepsentdate', 'noticedatereceived', 'finallienreceiveddate', 'reduction'] },
      { title: 'Notes', fields: ['notes'] },
      { title: 'Documents', fields: ['documents'] },
    ],
  },

  expenses: {
    noun: 'expense',
    left: 'payeename',
    right: 'amountofinvoice',
    status: 'type',
    groups: [
      { title: 'Invoice', fields: ['dateofinvoice', 'invoicenumber', 'facilityname', 'description'] },
      { title: 'Payment', fields: ['paybydate', 'amountpaid', 'recordsreceived', 'methodofpayment'] },
      { title: 'Notes', fields: ['notes'] },
      { title: 'Documents', fields: ['documents'] },
    ],
  },

  insurance: {
    noun: 'policy',
    left: 'insurancecompany',
    right: 'policylimits',
    status: 'insurancetype',
    groups: [
      { title: 'Policy', fields: ['liability', 'estimatedoneformva', 'claimnumber', 'policynumber'] },
      { title: 'People', fields: ['insured', 'driver', 'pdadjuster', 'biadjuster', 'pipadjuster'] },
      { title: 'Notes', fields: ['notes'] },
      { title: 'Documents', fields: ['fileattachment'] },
    ],
  },

  negotiations: {
    noun: 'offer',
    left: 'tofrom',
    right: 'amount',
    status: 'offerdemandsettled',
    groups: [
      { title: 'Details', fields: ['date', 'policylimitdemand'] },
      { title: 'Notes', fields: ['notes'] },
      { title: 'Documents', fields: ['docs'] },
    ],
  },

  'negotiations-mediation': {
    noun: 'mediation',
    left: 'mediator',
    right: 'date',
    status: 'outcome',
    groups: [
      { title: 'Mediation', fields: ['location', 'highestoffer', 'lowestdemand'] },
      { title: 'Notes', fields: ['notes'] },
      { title: 'Documents', fields: ['docs'] },
    ],
  },

  pleading: {
    noun: 'pleading',
    left: 'pleadingname',
    right: 'dateserved',
    status: 'pleadingtype',
    groups: [
      { title: 'Filing & response', fields: ['drafter', 'hearingdate', 'responder', 'responsedate', 'replier', 'replydate'] },
      { title: 'Order', fields: ['ordertendered'] },
      { title: 'Notes', fields: ['notes'] },
      { title: 'Documents', fields: ['documents'] },
    ],
  },

  depositions: {
    noun: 'deposition',
    left: 'deponent',
    right: 'datescheduled',
    groups: [
      { title: 'Scheduling', fields: ['time', 'location', 'defatty'] },
      { title: 'Status', fields: ['ourclientexpert', 'depositiontaken', 'clientprepped', 'prepdate'] },
      { title: 'Notes', fields: ['generalnotes', 'redflags'] },
      { title: 'Documents', fields: ['documents'] },
    ],
  },

  discovery: {
    noun: 'request',
    left: 'title',
    right: 'response',
    status: 'type',
    groups: [
      { title: 'Details', fields: ['inout', 'party', 'drafter', 'done'] },
      { title: 'Notes', fields: ['notes'] },
      { title: 'Documents', fields: ['discoverydocuments'] },
    ],
  },
};
