import test from 'node:test';
import assert from 'node:assert/strict';
import {
  csvCell, toCsv, caseListCsv, buildBackup, backupFilename,
  unimportableHeaders, CASE_COLUMNS, BACKUP_FORMAT,
} from './export.js';
import { mapHeaders, planImport, dateConventions } from './import.js';
import Papa from 'papaparse';

/* ------------------------------------------------------------------ *
 * CSV correctness
 * ------------------------------------------------------------------ */

test('commas, quotes and newlines survive a round trip through a cell', () => {
  assert.equal(csvCell('Rivera, Marcus'), '"Rivera, Marcus"');
  assert.equal(csvCell('he said "no"'), '"he said ""no"""');
  assert.equal(csvCell('line one\nline two'), '"line one\nline two"');
  assert.equal(csvCell('plain'), 'plain');
});

test('a cell that Excel would run as a formula is defused', () => {
  // Not hypothetical: "-see attached" is ordinary note text, and Excel treats
  // a leading - as the start of an expression.
  assert.equal(csvCell('=SUM(A1:A9)'), "'=SUM(A1:A9)");
  assert.equal(csvCell('-see attached'), "'-see attached");
  assert.equal(csvCell('+1 713 555 0100'), "'+1 713 555 0100");
  assert.equal(csvCell('@adjuster'), "'@adjuster");
});

test('empty and missing values become empty cells, not "null"', () => {
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
  assert.equal(csvCell(''), '');
  assert.equal(csvCell(0), '0');
});

test('the file starts with a BOM so Excel reads it as UTF-8', () => {
  const csv = toCsv([{ n: 'Ureña, José' }], [{ header: 'Name', value: (r) => r.n }]);
  assert.ok(csv.startsWith('﻿'), 'a missing BOM mangles every accented name');
  assert.ok(csv.includes('Ureña, José'));
});

/* ------------------------------------------------------------------ *
 * The round trip — an export has to be a restore
 * ------------------------------------------------------------------ */

test('every exported case column is one the importer recognises', () => {
  // If this fails, the export is a souvenir rather than a backup: those
  // columns come back as "Do not import" and someone has to notice.
  assert.deepEqual(unimportableHeaders(), []);
});

test('an exported case list imports back as an update, not a duplicate', () => {
  const matters = {
    m1: {
      values: {
        clientName: 'Rivera, Marcus', caseNumber: '26-001', status: 'Open',
        attorney: 'PH', doa: '2024-10-15', sol: '2026-10-15', trialDate: '2026-11-20',
      },
      lastActivityAt: '2026-08-30T12:00:00Z',
    },
  };

  const csv = caseListCsv(matters);

  /*
   * Parsed with papaparse and de-BOM'd exactly as app/import/page.jsx does, so
   * this exercises the real path rather than an approximation of it. An
   * earlier version of this test hand-rolled the CSV parse, got the cells out
   * of step, and blamed the exporter.
   */
  const { data } = Papa.parse(csv.trim(), { skipEmptyLines: 'greedy' });
  const headers = data[0].map((h, i) => (i === 0 ? String(h).replace(/^\ufeff/, '') : h));
  const rows = data.slice(1);

  const columns = mapHeaders(headers);
  const { entries } = planImport({
    rows, columns, matters, conventions: dateConventions(columns, rows),
  });

  assert.equal(entries[0].action, 'update', 'a re-import must not create a second case');
  assert.equal(entries[0].values.sol, '2026-10-15', 'the SOL must survive the trip');
  assert.equal(entries[0].values.trialDate, '2026-11-20');
  assert.equal(entries[0].values.clientName, 'Rivera, Marcus');
});

/* ------------------------------------------------------------------ *
 * The case list
 * ------------------------------------------------------------------ */

test('the case list leads with the columns a deadline depends on', () => {
  const keys = CASE_COLUMNS.map(([, key]) => key);
  for (const critical of ['clientName', 'caseNumber', 'sol', 'trialDate', 'dco']) {
    assert.ok(keys.includes(critical), `${critical} must be exported`);
  }
});

test('archived cases are exported and marked, not dropped', () => {
  // A backup that quietly omits closed files is not a backup of the firm.
  const csv = caseListCsv({
    m1: { values: { clientName: 'Open One' }, lastActivityAt: '2026-08-30' },
    m2: { values: { clientName: 'Closed One' }, archivedAt: '2026-07-01', lastActivityAt: '2026-07-01' },
  });
  assert.ok(csv.includes('Open One'));
  assert.ok(csv.includes('Closed One'));
  assert.match(csv, /Closed One.*,yes/);
});

test('the newest activity is at the top', () => {
  const csv = caseListCsv({
    old: { values: { clientName: 'Older' }, lastActivityAt: '2026-01-01' },
    recent: { values: { clientName: 'Newer' }, lastActivityAt: '2026-08-30' },
  });
  assert.ok(csv.indexOf('Newer') < csv.indexOf('Older'));
});

test('an empty firm exports a header row rather than an empty file', () => {
  const csv = caseListCsv({});
  assert.ok(csv.includes('Client Name'));
  assert.equal(csv.replace(/^﻿/, '').trim().split('\r\n').length, 1);
});

/* ------------------------------------------------------------------ *
 * The full backup
 * ------------------------------------------------------------------ */

test('the backup carries everything, and counts it', () => {
  const b = buildBackup({
    matters: { m1: { values: {} } },
    tasks: { t1: {} },
    activity: { a1: {} },
    sections: { m1: { meds: { fields: {}, rows: [{ id: 'r1' }] } } },
    relations: [{ id: 'x' }],
    team: { u1: {} },
    exportedAt: '2026-08-31T20:00:00.000Z',
  });

  assert.equal(b.format, BACKUP_FORMAT);
  assert.equal(b.exportedAt, '2026-08-31T20:00:00.000Z');
  assert.deepEqual(b.counts, { matters: 1, tasks: 1, activity: 1, sections: 1, relations: 1 });
  // Section ROWS are the medical bills and expenses. Losing them loses the
  // arithmetic behind every settlement figure.
  assert.equal(b.sections.m1.meds.rows[0].id, 'r1');
});

test('a backup of nothing is still a valid backup', () => {
  const b = buildBackup({ exportedAt: '2026-08-31T20:00:00.000Z' });
  assert.equal(b.format, BACKUP_FORMAT);
  assert.deepEqual(b.counts, { matters: 0, tasks: 0, activity: 0, sections: 0, relations: 0 });
});

test('the filename sorts chronologically in a folder', () => {
  assert.equal(backupFilename('2026-08-31T20:00:00.000Z'), 'higdon-backup-2026-08-31.json');
  assert.equal(backupFilename('2026-08-31T20:00:00.000Z', 'csv'), 'higdon-backup-2026-08-31.csv');
  assert.equal(backupFilename(''), 'higdon-backup-undated.json');
});

test('the backup is JSON-serialisable, which is the only thing it must be', () => {
  const b = buildBackup({
    matters: { m1: { values: { clientName: 'Rivera, Marcus', served: { done: true } } } },
    exportedAt: '2026-08-31T20:00:00.000Z',
  });
  const round = JSON.parse(JSON.stringify(b));
  assert.equal(round.matters.m1.values.served.done, true);
});

/* ------------------------------------------------------------------ *
 * Restoring a case that has no case number
 * ------------------------------------------------------------------ */

function reimport(matters) {
  const csv = caseListCsv(matters);
  const { data } = Papa.parse(csv.trim(), { skipEmptyLines: 'greedy' });
  const headers = data[0].map((h, i) => (i === 0 ? String(h).replace(/^﻿/, '') : h));
  const rows = data.slice(1);
  const columns = mapHeaders(headers);
  return planImport({ rows, columns, matters, conventions: dateConventions(columns, rows) });
}

test('a case with no case number still restores as an update', () => {
  // Most cases have no number while the firm is rebuilding its list, so
  // without the internal id a restore would silently double the file.
  const matters = {
    'uuid-1': { values: { clientName: 'Bergstrom, Lena', sol: '2027-07-12' }, lastActivityAt: '2026-08-30' },
  };
  const { entries, summary } = reimport(matters);

  assert.equal(summary.create, 0, 'restoring must not create a second copy');
  assert.equal(entries[0].action, 'update');
  assert.equal(entries[0].matterId, 'uuid-1');
});

test('the internal id is used for matching and never stored as data', () => {
  // Left in `values` it would be written to the JSONB tail as a field nothing
  // reads, on every case, on every restore.
  const matters = { 'uuid-1': { values: { clientName: 'Bergstrom, Lena' }, lastActivityAt: '2026-08-30' } };
  const { entries } = reimport(matters);
  assert.equal(entries[0].values.internalId, undefined);
  assert.equal('internalId' in entries[0].values, false);
});

test('a whole firm round-trips with nothing created', () => {
  const matters = {
    'uuid-1': { values: { clientName: 'Rivera, Marcus', caseNumber: '26-001', sol: '2026-10-15' }, lastActivityAt: '2026-08-30' },
    'uuid-2': { values: { clientName: 'Bergstrom, Lena' }, lastActivityAt: '2026-08-29' },
    'uuid-3': { values: { clientName: 'Okafor, Ada', caseNumber: '26-002' }, archivedAt: '2026-07-01', lastActivityAt: '2026-07-01' },
  };
  const { summary } = reimport(matters);
  assert.equal(summary.create, 0);
  assert.equal(summary.update, 3, 'including the archived one');
  assert.equal(summary.skip, 0);
});

test('an id from some other system does not match, and the row is created', () => {
  // A restore into an empty database is a create, which is correct.
  const csv = caseListCsv({
    'uuid-1': { values: { clientName: 'Rivera, Marcus', caseNumber: '26-001' }, lastActivityAt: '2026-08-30' },
  });
  const { data } = Papa.parse(csv.trim(), { skipEmptyLines: 'greedy' });
  const headers = data[0].map((h, i) => (i === 0 ? String(h).replace(/^﻿/, '') : h));
  const rows = data.slice(1);
  const columns = mapHeaders(headers);
  const { entries } = planImport({ rows, columns, matters: {}, conventions: dateConventions(columns, rows) });

  assert.equal(entries[0].action, 'create');
  assert.equal(entries[0].values.clientName, 'Rivera, Marcus');
  assert.equal(entries[0].values.internalId, undefined);
});

test('a case number still matches when there is no internal id column', () => {
  // A spreadsheet typed by a paralegal has no internal ids, and must still work.
  const matters = { 'uuid-1': { values: { clientName: 'Rivera, Marcus', caseNumber: '26-001' } } };
  const columns = mapHeaders(['Client Name', 'Case Number']);
  const { entries } = planImport({ rows: [['Rivera, Marcus', '26-001']], columns, matters });
  assert.equal(entries[0].action, 'update');
  assert.equal(entries[0].matterId, 'uuid-1');
});
