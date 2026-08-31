/**
 * Contacts — a client as a record rather than a string.
 *
 * Until now a client was `matter.client_name`, free text, retyped per case.
 * "Rivera, Marcus" on two matters was two unrelated strings: correcting a
 * phone number on one left the other stale, and nothing could answer "what
 * else is this person on".
 *
 * Pure, so the searching and matching can be tested without a database. The
 * store handles persistence; everything here is a function of its arguments.
 */

/* ------------------------------------------------------------------ *
 * Names
 * ------------------------------------------------------------------ */

export function emptyContact() {
  return {
    kind: 'person',
    firstName: '', middleName: '', lastName: '', prefix: '', suffix: '', nickname: '',
    companyName: '', department: '', jobTitle: '',
    phones: [], emails: [], addresses: [],
    salutation: '', primaryLanguage: '', dateOfBirth: '', deceased: false,
    canText: false, canRemarket: false, isMinor: false,
    gender: '', maritalStatus: '', driverLicense: '', fiduciary: '', notes: '',
    clientEntityId: '', ssn: '', tags: [],
  };
}

/**
 * How the firm writes a client: surname first, because that is how a list of
 * 256 of them is read and how every case is named.
 */
export function displayName(contact = {}) {
  if (contact.kind === 'company') return (contact.companyName || '').trim();
  const last = (contact.lastName || '').trim();
  const first = (contact.firstName || '').trim();
  const suffix = (contact.suffix || '').trim();
  if (last && first) return `${last}, ${first}${suffix ? ` ${suffix}` : ''}`;
  return last || first || (contact.companyName || '').trim();
}

/** "Marcus Rivera" — for a letter, where surname-first reads as a filing label. */
export function naturalName(contact = {}) {
  if (contact.kind === 'company') return (contact.companyName || '').trim();
  return [contact.prefix, contact.firstName, contact.middleName, contact.lastName, contact.suffix]
    .map((p) => (p || '').trim())
    .filter(Boolean)
    .join(' ');
}

/** A contact must be findable by something. Matches the check constraint. */
export function validateContact(contact = {}) {
  const errors = [];
  if (contact.kind === 'company') {
    if (!(contact.companyName || '').trim()) errors.push('A company needs a name.');
  } else if (!(contact.firstName || '').trim() && !(contact.lastName || '').trim()) {
    errors.push('A first or last name is required.');
  }
  for (const e of contact.emails || []) {
    const v = (e?.value || '').trim();
    if (v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) errors.push(`"${v}" is not an email address.`);
  }
  return errors;
}

/* ------------------------------------------------------------------ *
 * Search
 * ------------------------------------------------------------------ */

const fold = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    // Strip accents, so "Ureña" is found by typing "urena".
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9@.\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Everything a contact can be found by, folded into one string. */
export function searchHaystack(contact = {}) {
  const parts = [
    contact.firstName, contact.lastName, contact.middleName, contact.nickname,
    contact.companyName, contact.clientEntityId,
    ...(contact.emails || []).map((e) => e?.value),
    ...(contact.phones || []).map((p) => String(p?.value || '').replace(/\D/g, '')),
  ];
  return fold(parts.filter(Boolean).join(' '));
}

/**
 * Type-ahead over a loaded list.
 *
 * Every term must match the start of some word, so "riv mar" finds
 * "Rivera, Marcus" and "mar" alone does not rank "Rivera" above "Marquez".
 * Prefix rather than substring because a paralegal types the beginning of a
 * name, and substring matching on 256 contacts turns "an" into everything.
 *
 * Digits are matched against the digits of a phone number, so a client can be
 * found by the number they are calling from.
 */
export function searchContacts(contacts = [], query = '', { limit = 8 } = {}) {
  const q = fold(query);
  if (!q) return [];
  const terms = q.split(' ').filter(Boolean);

  const scored = [];
  for (const contact of contacts) {
    if (contact?.deletedAt) continue;
    const hay = searchHaystack(contact);
    const words = hay.split(' ');

    let score = 0;
    const everyTermMatches = terms.every((term) => {
      const exact = words.includes(term);
      const prefix = words.some((w) => w.startsWith(term));
      /*
       * Digits match ANYWHERE in a phone number, not just at the front.
       * Nobody looking up a caller types the area code first -- they read the
       * last four off the screen. Prefix matching alone found "713..." and
       * missed "...0142", which is the half people actually use.
       *
       * Confined to all-digit terms so a name search stays prefix-based and
       * "an" does not match every contact with those letters anywhere.
       */
      const digits = /^\d+$/.test(term)
        && words.some((w) => /^\d+$/.test(w) && w.includes(term));
      if (exact) score += 3;
      else if (prefix || digits) score += 1;
      return exact || prefix || digits;
    });
    if (!everyTermMatches) continue;

    // A surname the user is clearly typing outranks a nickname collision.
    if (fold(contact.lastName).startsWith(terms[0])) score += 2;
    scored.push({ contact, score });
  }

  return scored
    .sort((a, b) =>
      b.score - a.score || displayName(a.contact).localeCompare(displayName(b.contact)))
    .slice(0, limit)
    .map((s) => s.contact);
}

/* ------------------------------------------------------------------ *
 * Duplicates
 * ------------------------------------------------------------------ */

/**
 * Contacts that look like the one being created.
 *
 * Shown as a warning, never as a block. The firm has genuine same-name
 * clients -- two people called Maria Garcia is not a data-entry error -- so
 * this surfaces the collision and lets a person decide, which is the same
 * rule the Drive folder matcher follows.
 */
export function duplicateCandidates(contacts = [], candidate = {}) {
  const name = fold(displayName(candidate));
  if (!name) return [];

  const emails = new Set(
    (candidate.emails || []).map((e) => fold(e?.value)).filter(Boolean)
  );
  const phones = new Set(
    (candidate.phones || []).map((p) => String(p?.value || '').replace(/\D/g, '')).filter(Boolean)
  );

  return contacts.filter((c) => {
    if (!c || c.id === candidate.id || c.deletedAt) return false;
    if (fold(displayName(c)) === name) return true;
    if ((c.emails || []).some((e) => emails.has(fold(e?.value)))) return true;
    if ((c.phones || []).some((p) => phones.has(String(p?.value || '').replace(/\D/g, '')))) return true;
    return false;
  });
}

/* ------------------------------------------------------------------ *
 * Repeating groups
 * ------------------------------------------------------------------ */

export const PHONE_LABELS = ['Phone', 'Mobile', 'Home', 'Work', 'Fax', 'Other'];
export const EMAIL_LABELS = ['Email', 'Home', 'Work', 'Other'];
export const ADDRESS_LABELS = ['Address', 'Home', 'Work', 'Mailing', 'Other'];

/** Drop entries the user opened a row for and never filled in. */
export function pruneEntries(contact = {}) {
  const some = (o, keys) => keys.some((k) => String(o?.[k] || '').trim());
  return {
    ...contact,
    phones: (contact.phones || []).filter((p) => some(p, ['value'])),
    emails: (contact.emails || []).filter((e) => some(e, ['value'])),
    addresses: (contact.addresses || []).filter((a) =>
      some(a, ['line1', 'line2', 'city', 'state', 'postal'])),
  };
}

/* ------------------------------------------------------------------ *
 * Roles
 * ------------------------------------------------------------------ */

/**
 * WHAT a contact is to the firm, as distinct from what it *is*.
 *
 * `kind` is person-or-company and answers how to write the name. It cannot
 * answer the question the Contacts page is for -- "which orthopaedic clinics
 * do we use" -- because a clinic and a defence firm are both companies, and an
 * adjuster and a client are both people.
 *
 * Roles are a LIST, not a field, because the same record genuinely holds
 * several: the client's mother is an emergency contact on one case and the
 * plaintiff on another; a doctor is a treating provider and later a testifying
 * expert. Forcing one would mean a second record for the same person, which is
 * the exact thing contacts exist to stop.
 *
 * ── No migration ──────────────────────────────────────────────────────────
 *
 * These live in `contact.tags text[]`, which 008 already created. A role is a
 * tag with a name the app knows; a tag the app does not know still round-trips
 * untouched, so the firm can invent its own without waiting for a release.
 */
export const CONTACT_ROLES = [
  'Client',
  'Medical Provider',
  'Insurance Company',
  'Adjuster',
  'Attorney',
  'Expert',
  'Witness',
  'Court',
  'Employer',
  'Other',
];

const ROLE_SET = new Set(CONTACT_ROLES);

/** The known roles on a contact, in CONTACT_ROLES order rather than tag order. */
export function rolesOf(contact = {}) {
  const tags = new Set((contact.tags || []).map((t) => String(t || '').trim()));
  return CONTACT_ROLES.filter((r) => tags.has(r));
}

/** Tags that are not roles. Preserved on save; shown as plain tags. */
export function freeTagsOf(contact = {}) {
  return (contact.tags || [])
    .map((t) => String(t || '').trim())
    .filter((t) => t && !ROLE_SET.has(t));
}

export function hasRole(contact = {}, role) {
  return rolesOf(contact).includes(role);
}

/**
 * Add or remove one role, leaving every other tag exactly as it was.
 *
 * Rebuilt from `rolesOf` + `freeTagsOf` rather than spliced, so the stored
 * order is stable and a duplicate tag cannot accumulate.
 */
export function toggleRole(contact = {}, role, on) {
  const roles = new Set(rolesOf(contact));
  if (on) roles.add(role); else roles.delete(role);
  return {
    ...contact,
    tags: [...CONTACT_ROLES.filter((r) => roles.has(r)), ...freeTagsOf(contact)],
  };
}

/* ------------------------------------------------------------------ *
 * Browsing
 * ------------------------------------------------------------------ */

/**
 * The Contacts page list. NOT `searchContacts`.
 *
 * Type-ahead and browsing want opposite things and conflating them is why
 * directory pages feel broken. `searchContacts` matches word PREFIXES and caps
 * at eight, which is right when a picker is racing your keystrokes and wrong
 * when you are looking through the whole roster: there, typing "ortho" should
 * find "Northside Orthopaedics", and an empty box should show everybody rather
 * than nothing.
 *
 * So: substring, no cap, and an empty query lists the lot.
 */
export function browseContacts(contacts = [], { query = '', role = '' } = {}) {
  const q = fold(query);
  const out = [];

  for (const contact of contacts) {
    if (!contact || contact.deletedAt) continue;
    if (role && !hasRole(contact, role)) continue;
    if (q) {
      const hay = `${searchHaystack(contact)} ${fold(displayName(contact))}`;
      // Every term, anywhere -- "riv hous" finds Rivera in Houston.
      if (!q.split(' ').filter(Boolean).every((term) => hay.includes(term))) continue;
    }
    out.push(contact);
  }

  return out.sort((a, b) => displayName(a).localeCompare(displayName(b)));
}

/** How many contacts carry each role. Drives the counts on the filter chips. */
export function roleCounts(contacts = []) {
  const counts = Object.fromEntries(CONTACT_ROLES.map((r) => [r, 0]));
  let untagged = 0;
  for (const contact of contacts) {
    if (!contact || contact.deletedAt) continue;
    const roles = rolesOf(contact);
    if (!roles.length) untagged += 1;
    for (const r of roles) counts[r] += 1;
  }
  return { counts, untagged };
}

/**
 * Contacts whose name is the same as this one, folded.
 *
 * For offering the obvious link on a case that has a client NAME and no
 * client RECORD — which is every case imported from a spreadsheet or created
 * from a Drive folder. "Adetan, Abimbola Michelle" on the matter and the same
 * string on a contact is almost always the same person, and making that one
 * click rather than a search is the difference between the link happening and
 * not happening across 343 cases.
 *
 * Offered, never applied. Two clients genuinely called Maria Garcia is not a
 * data-entry error, so several matches means a person still chooses — the same
 * rule `duplicateCandidates` and the Drive folder matcher follow.
 */
export function matchContactsByName(contacts = [], name) {
  const key = fold(name);
  if (!key) return [];
  return contacts.filter((c) => c && !c.deletedAt && fold(displayName(c)) === key);
}

/** The first phone and email, whatever their labels. What a header shows. */
export function primaryPhone(contact) {
  return (contact?.phones || []).map((p) => String(p?.value || '').trim()).find(Boolean) || '';
}

export function primaryEmail(contact) {
  return (contact?.emails || []).map((e) => String(e?.value || '').trim()).find(Boolean) || '';
}
