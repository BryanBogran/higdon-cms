/**
 * Getting the firm's data back out.
 *
 * Written the week the firm lost access to its previous system with no export,
 * which is the entire argument for this file. A system of record that cannot
 * hand back its records is a system you are trapped in, and the trap is only
 * visible on the day you need out.
 *
 * Two outputs, for two different jobs:
 *
 *   The CASE LIST is a CSV a person can read, open in Excel, and hand to
 *   anyone. Its columns are deliberately the ones lib/domain/import.js can
 *   read back, so an export is a restore and not just a souvenir. A test
 *   asserts that round trip, because a backup nobody has restored is a rumour.
 *
 *   The FULL BACKUP is JSON, and keeps everything the CSV flattens away --
 *   checklist items, section rows, activity, tasks, relations. Nothing here
 *   is lossy, so a future importer can be written against it even if the
 *   schema has moved on.
 */

import { HEADER_MAP } from './fields.js';

/* ------------------------------------------------------------------ *
 * CSV
 * ------------------------------------------------------------------ */

/**
 * Quote a value for CSV, and defuse it for Excel.
 *
 * A cell beginning = + - or @ is a FORMULA to Excel and Sheets, so a note
 * reading "=cmd|..." becomes executable the moment someone opens the export.
 * The standard mitigation is a leading apostrophe, which Excel eats on display
 * and which survives re-import as a value.
 *
 * The firm's own notes contain things like "-see attached", so this is not
 * hypothetical; it is just usually harmless. Usually is not a security
 * property.
 */
export function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/["\n\r,]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows, columns) {
  const head = columns.map((c) => csvCell(c.header)).join(',');
  const body = rows.map((row) => columns.map((c) => csvCell(c.value(row))).join(','));
  // CRLF because Excel is the destination, and a BOM so it reads the file as
  // UTF-8 rather than mangling every accented client name.
  return `﻿${[head, ...body].join('\r\n')}\r\n`;
}

/* ------------------------------------------------------------------ *
 * The case list
 * ------------------------------------------------------------------ */

/*
 * Header text on the left, app field on the right. The header strings are
 * chosen to match HEADER_MAP so the importer recognises them without anyone
 * having to map columns by hand on the way back in.
 */
export const CASE_COLUMNS = [
  ['Client Name', 'clientName'],
  ['Case Number', 'caseNumber'],
  ['Status', 'status'],
  ['Attorney', 'attorney'],
  ['Date Opened', 'openDate'],
  ['DOA', 'doa'],
  ['SOL', 'sol'],
  ['Trial Date', 'trialDate'],
  ['DCO', 'dco'],
  ['Opposing Counsel', 'opposingCounsel'],
  ['Insurance', 'insurance'],
  ['Referral', 'referral'],
  ['Settlement Amount', 'settlementAmount'],
  ['Settlement Date', 'settlementDate'],
  ['How Settled', 'howSettled'],
  ['Check Status', 'checkStatus'],
  ['Cross-Ref Case', 'crossRefCase'],
];

/*
 * Last, because nobody reading this in Excel cares about it, and first in
 * importance if the file is ever used to restore: it is the only thing that
 * can match a case carrying no case number.
 */
export const ID_COLUMN = 'Internal ID';

/** Matters as a CSV, newest activity first, archived ones marked not omitted. */
export function caseListCsv(matters = {}) {
  const rows = Object.entries(matters)
    .map(([id, m]) => ({ id, ...m }))
    .sort((a, b) => String(b.lastActivityAt || '').localeCompare(String(a.lastActivityAt || '')));

  const columns = [
    ...CASE_COLUMNS.map(([header, key]) => ({
      header,
      value: (r) => r.values?.[key] ?? '',
    })),
    { header: ID_COLUMN, value: (r) => r.id },
    // Not importable, but the two questions asked of a backup most often are
    // "when was this last touched" and "where are its documents".
    { header: 'Drive Folder', value: (r) => r.driveFolderName || '' },
    { header: 'Last Activity', value: (r) => r.lastActivityAt || '' },
    { header: 'Archived', value: (r) => (r.archivedAt ? 'yes' : '') },
  ];

  return toCsv(rows, columns);
}

/* ------------------------------------------------------------------ *
 * The full backup
 * ------------------------------------------------------------------ */

export const BACKUP_FORMAT = 1;

/**
 * Everything, losslessly.
 *
 * `exportedAt` is passed in rather than read from the clock so this stays
 * pure and the filename and the contents cannot disagree.
 */
export function buildBackup({
  matters = {}, tasks = {}, activity = {}, sections = {}, relations = [], team = {},
  exportedAt,
} = {}) {
  return {
    format: BACKUP_FORMAT,
    exportedAt,
    counts: {
      matters: Object.keys(matters).length,
      tasks: Object.keys(tasks).length,
      activity: Object.keys(activity).length,
      sections: Object.keys(sections).length,
      relations: relations.length,
    },
    matters,
    tasks,
    activity,
    sections,
    relations,
    team,
  };
}

/** `higdon-backup-2026-08-31.json`. Sorts chronologically in a folder. */
export function backupFilename(isoDate, extension = 'json') {
  const day = String(isoDate || '').slice(0, 10) || 'undated';
  return `higdon-backup-${day}.${extension}`;
}

/* ------------------------------------------------------------------ *
 * The property that makes this a restore
 * ------------------------------------------------------------------ */

/**
 * Which exported headers the importer would NOT recognise.
 *
 * Empty is the requirement for every column carrying case data. Anything
 * listed here comes back as "Do not import" and has to be mapped by hand,
 * which on a bad day nobody will think to do.
 */
export function unimportableHeaders() {
  const known = new Set(HEADER_MAP.map(([prefix]) => prefix));
  return CASE_COLUMNS
    .map(([header]) => header)
    .filter((header) => !known.has(header.toUpperCase()));
}
