import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectDateConvention, parseImportDate, excelSerialToISO, normalizeStatus,
  mapHeaders, dateConventions, planImport, splitProjectName, caseKey, unresolvedDateColumns, spreadsheetRow,
} from './import.js';

/* ------------------------------------------------------------------ *
 * Date convention — the part that stops a wrong SOL
 * ------------------------------------------------------------------ */

test('a 13th or higher in the first position proves day-first', () => {
  assert.equal(detectDateConvention(['03/04/2026', '15/01/2026']), 'DMY');
});

test('a 13th or higher in the second position proves month-first', () => {
  assert.equal(detectDateConvention(['03/04/2026', '01/15/2026']), 'MDY');
});

test('both proofs at once is a conflict, not a coin toss', () => {
  assert.equal(detectDateConvention(['15/01/2026', '01/15/2026']), 'conflict');
});

test('a column that never disambiguates is ambiguous, not assumed', () => {
  assert.equal(detectDateConvention(['03/04/2026', '05/06/2026']), 'ambiguous');
});

test('ISO columns need no convention', () => {
  assert.equal(detectDateConvention(['2026-10-15', '2026-11-20']), 'ISO');
});

test('blanks do not vote', () => {
  assert.equal(detectDateConvention(['', '  ', null, undefined]), 'empty');
  assert.equal(detectDateConvention(['', '01/15/2026', null]), 'MDY');
});

test('an ambiguous cell is refused rather than guessed', () => {
  // This is the whole point: no answer beats a plausible wrong answer.
  assert.equal(parseImportDate('03/04/2026', 'ambiguous'), null);
  assert.equal(parseImportDate('03/04/2026', 'conflict'), null);
});

test('the same cell reads differently under each convention', () => {
  assert.equal(parseImportDate('03/04/2026', 'MDY'), '2026-03-04');
  assert.equal(parseImportDate('03/04/2026', 'DMY'), '2026-04-03');
});

test('an unambiguous cell parses even with no convention settled', () => {
  assert.equal(parseImportDate('15/01/2026', 'ambiguous'), '2026-01-15');
  assert.equal(parseImportDate('01/15/2026', 'ambiguous'), '2026-01-15');
});

/* ------------------------------------------------------------------ *
 * Date formats
 * ------------------------------------------------------------------ */

test('ISO passes through, and an impossible ISO date is refused', () => {
  assert.equal(parseImportDate('2026-10-15'), '2026-10-15');
  assert.equal(parseImportDate('2026-02-30'), null);
});

test('two-digit years land in this century, not the next', () => {
  assert.equal(parseImportDate('10/15/26', 'MDY'), '2026-10-15');
  assert.equal(parseImportDate('10/15/98', 'MDY'), '1998-10-15');
});

test('written-out months parse both ways round', () => {
  assert.equal(parseImportDate('March 4, 2026'), '2026-03-04');
  assert.equal(parseImportDate('Mar 4 2026'), '2026-03-04');
  assert.equal(parseImportDate('4 Mar 2026'), '2026-03-04');
  assert.equal(parseImportDate('October 15th, 2026'), '2026-10-15');
});

test('dots and dashes separate as well as slashes', () => {
  assert.equal(parseImportDate('10.15.2026', 'MDY'), '2026-10-15');
  assert.equal(parseImportDate('10-15-2026', 'MDY'), '2026-10-15');
});

test('Excel day counts become dates', () => {
  // 45000 is 2023-03-15 counting from 1899-12-30.
  assert.equal(excelSerialToISO(45000), '2023-03-15');
  assert.equal(parseImportDate('45000'), '2023-03-15');
});

test('a number outside the plausible range is not a date', () => {
  assert.equal(excelSerialToISO(3), null);
  assert.equal(excelSerialToISO(999999), null);
  assert.equal(excelSerialToISO(12.5), null);
});

test('junk returns null rather than a date-shaped lie', () => {
  for (const junk of ['', '   ', 'n/a', 'TBD', 'pending', 'see file', null, undefined]) {
    assert.equal(parseImportDate(junk, 'MDY'), null, `${junk} should not parse`);
  }
});

/* ------------------------------------------------------------------ *
 * Status
 * ------------------------------------------------------------------ */

test('status synonyms land on the four the app knows', () => {
  assert.equal(normalizeStatus('Open').status, 'Open');
  assert.equal(normalizeStatus('active').status, 'Open');
  assert.equal(normalizeStatus('Pre-Suit').status, 'Open');
  assert.equal(normalizeStatus('CLOSED').status, 'Closed');
  assert.equal(normalizeStatus('Settled').status, 'Settled - Not Disbursed');
  assert.equal(normalizeStatus('Default Judgment').status, 'Default Judgment');
});

test('an unknown status imports as Open and says so', () => {
  const r = normalizeStatus('Referred Out');
  assert.equal(r.status, 'Open');
  assert.equal(r.recognized, false);
});

test('a blank status is Open without complaint', () => {
  assert.deepEqual(normalizeStatus(''), { status: 'Open', recognized: true });
});

/* ------------------------------------------------------------------ *
 * Header mapping
 * ------------------------------------------------------------------ */

test('headers map onto fields the app already knows', () => {
  const cols = mapHeaders(['Client Name', 'Case Number', 'SOL', 'Trial Date']);
  assert.deepEqual(cols.map((c) => c.key), ['clientName', 'caseNumber', 'sol', 'trialDate']);
});

test('an unrecognised header maps to nothing rather than something close', () => {
  const [col] = mapHeaders(['Adjuster Phone']);
  assert.equal(col.key, '');
  assert.equal(col.field, null);
});

test('a human override beats the guess, and an empty override drops the column', () => {
  const cols = mapHeaders(['Client Name', 'Case Number'], { 0: 'attorney', 1: '' });
  assert.equal(cols[0].key, 'attorney');
  assert.equal(cols[0].overridden, true);
  assert.equal(cols[1].key, '');
});

test('conventions are detected per date column, not per file', () => {
  const cols = mapHeaders(['Client Name', 'SOL', 'Trial Date']);
  const rows = [
    ['Rivera, Marcus', '15/01/2026', '01/15/2026'],
    ['Okafor, Ada', '03/04/2026', '03/04/2026'],
  ];
  assert.deepEqual(dateConventions(cols, rows), { sol: 'DMY', trialDate: 'MDY' });
});

/* ------------------------------------------------------------------ *
 * The plan
 * ------------------------------------------------------------------ */

const COLS = mapHeaders(['Client Name', 'Case Number', 'SOL', 'Status']);

function plan(rows, matters = {}, extra = {}) {
  return planImport({
    rows,
    columns: COLS,
    matters,
    conventions: { sol: 'ISO' },
    ...extra,
  });
}

test('a new case number creates', () => {
  const { entries, summary } = plan([['Rivera, Marcus', '26-001', '2026-10-15', 'Open']]);
  assert.equal(entries[0].action, 'create');
  assert.equal(entries[0].values.sol, '2026-10-15');
  assert.equal(summary.create, 1);
  assert.equal(summary.withSol, 1);
});

test('a case number already on file updates instead of duplicating', () => {
  const matters = { abc: { values: { clientName: 'Rivera, Marcus', caseNumber: '26-001' } } };
  const { entries, summary } = plan([['Rivera, Marcus', '26-001', '2026-10-15', 'Open']], matters);
  assert.equal(entries[0].action, 'update');
  assert.equal(entries[0].matterId, 'abc');
  assert.equal(summary.update, 1);
});

test('case numbers match despite spacing and case', () => {
  const matters = { abc: { values: { clientName: 'X', caseNumber: '26-001' } } };
  const { entries } = plan([['Rivera, Marcus', ' 26-001 ', '', '']], matters);
  assert.equal(entries[0].action, 'update');
  assert.equal(caseKey(' 26-001 '), '26-001');
});

test('a row with no client name is skipped, and says why', () => {
  const { entries } = plan([['', '26-001', '2026-10-15', 'Open']]);
  assert.equal(entries[0].action, 'skip');
  assert.match(entries[0].reason, /client name/i);
});

test('a file that repeats a case number imports it once', () => {
  const { entries, summary } = plan([
    ['Rivera, Marcus', '26-001', '2026-10-15', 'Open'],
    ['Rivera, Marcus', '26-001', '2026-11-20', 'Open'],
  ]);
  assert.equal(entries[0].action, 'create');
  assert.equal(entries[1].action, 'skip');
  assert.match(entries[1].reason, /row 2 of this file/);
  assert.equal(summary.create, 1);
});

test('a row with no case number warns that re-import will duplicate it', () => {
  const { entries } = plan([['Rivera, Marcus', '', '2026-10-15', 'Open']]);
  assert.equal(entries[0].action, 'create');
  assert.ok(entries[0].warnings.some((w) => /cannot be matched/.test(w)));
});

test('a nameless-numbered row warns when that client already exists', () => {
  const matters = { abc: { values: { clientName: 'Marcus Rivera', caseNumber: '26-001' } } };
  const { entries } = plan([['Rivera, Marcus', '', '2026-10-15', 'Open']], matters);
  // nameKey sorts tokens, so "Rivera, Marcus" and "Marcus Rivera" collide.
  assert.ok(entries[0].warnings.some((w) => /already exists/.test(w)));
});

test('an unreadable date is reported, and the rest of the row still imports', () => {
  const { entries } = plan([['Rivera, Marcus', '26-001', 'ask Paul', 'Open']]);
  assert.equal(entries[0].action, 'create');
  assert.equal(entries[0].values.sol, undefined);
  assert.equal(entries[0].values.clientName, 'Rivera, Marcus');
  assert.ok(entries[0].warnings.some((w) => /not a date/.test(w)));
});

test('an ambiguous date column is refused per row, with the reason', () => {
  const { entries } = plan(
    [['Rivera, Marcus', '26-001', '03/04/2026', 'Open']],
    {},
    { conventions: { sol: 'ambiguous' } },
  );
  assert.equal(entries[0].values.sol, undefined);
  assert.ok(entries[0].warnings.some((w) => /ambiguous/.test(w)));
});

test('resolving the convention by hand unblocks the column', () => {
  const { entries } = plan(
    [['Rivera, Marcus', '26-001', '03/04/2026', 'Open']],
    {},
    { conventions: { sol: 'ambiguous' }, resolvedConventions: { sol: 'MDY' } },
  );
  assert.equal(entries[0].values.sol, '2026-03-04');
});

test('unresolved columns are listed until a human settles them', () => {
  assert.deepEqual(
    unresolvedDateColumns({ sol: 'ambiguous', trialDate: 'MDY' }, {}),
    [{ key: 'sol', convention: 'ambiguous', label: 'SOL' }],
  );
  assert.deepEqual(unresolvedDateColumns({ sol: 'ambiguous' }, { sol: 'MDY' }), []);
});

/* ------------------------------------------------------------------ *
 * Checklist columns
 * ------------------------------------------------------------------ */

test('checklist columns get a convention detected, like any other date column', () => {
  // Regression. These were skipped, so every embedded date fell through to
  // 'ambiguous' and was refused: the completion saved and the date vanished.
  // chain.js builds deadlines from five of these keys, so that is a missing
  // deadline, not a missing detail.
  const cols = mapHeaders(['Client Name', 'Served']);
  const rows = [['Rivera, Marcus', 'yes - 3/1/26'], ['Okafor, Ada', 'yes - 11/20/26']];
  assert.equal(dateConventions(cols, rows).served, 'MDY');
});

test('the whole path, with conventions computed rather than supplied', () => {
  // Exactly what the screen does: map headers, detect, plan. An earlier
  // version of this test handed in { suitFiled: 'MDY' } by hand, which the UI
  // never does -- so it passed while the real path dropped the date.
  const cols = mapHeaders(['Client Name', 'Suit Filed']);
  const rows = [['Rivera, Marcus', 'yes - 3/1/26'], ['Okafor, Ada', 'yes - 11/20/26']];
  const { entries } = planImport({ rows, columns: cols, conventions: dateConventions(cols, rows) });
  assert.equal(entries[0].checklist.suitFiled.date, '2026-03-01');
  assert.equal(entries[1].checklist.suitFiled.date, '2026-11-20');
});

test('"yes - 3/1/26" is both a completion and a date', () => {
  const cols = mapHeaders(['Client Name', 'Suit Filed']);
  const { entries } = planImport({
    rows: [['Rivera, Marcus', 'yes - 3/1/26']],
    columns: cols,
    conventions: { suitFiled: 'MDY' },
  });
  assert.deepEqual(entries[0].checklist.suitFiled, { done: true, date: '2026-03-01', note: '' });
});

test('a plain yes is done with no date', () => {
  const cols = mapHeaders(['Client Name', 'Served']);
  const { entries } = planImport({ rows: [['Rivera, Marcus', 'Yes']], columns: cols });
  assert.deepEqual(entries[0].checklist.served, { done: true, date: '', note: '' });
});

test('a qualified yes keeps its qualification', () => {
  // "yes" and the date are captured into their own fields, but the clause
  // between them exists nowhere else and must survive.
  const cols = mapHeaders(['Client Name', 'Suit Filed']);
  const { entries } = planImport({
    rows: [['Rivera, Marcus', 'yes, but only as to Metro - 3/1/26']],
    columns: cols,
    conventions: { suitFiled: 'MDY' },
  });
  assert.deepEqual(entries[0].checklist.suitFiled, {
    done: true,
    date: '2026-03-01',
    note: 'yes, but only as to Metro - 3/1/26',
  });
});

test('a bare date with no yes still yields the date and drops no text', () => {
  const cols = mapHeaders(['Client Name', 'Served']);
  const { entries } = planImport({
    rows: [['Rivera, Marcus', '3/1/26']],
    columns: cols,
    conventions: { served: 'MDY' },
  });
  assert.deepEqual(entries[0].checklist.served, { done: false, date: '2026-03-01', note: '' });
});

test('text that is not yes is kept verbatim rather than discarded', () => {
  const cols = mapHeaders(['Client Name', 'Served']);
  const { entries } = planImport({ rows: [['Rivera, Marcus', 'waiting on citation']], columns: cols });
  assert.deepEqual(entries[0].checklist.served, { done: false, date: '', note: 'waiting on citation' });
});

/* ------------------------------------------------------------------ *
 * Summary
 * ------------------------------------------------------------------ */

test('row numbers in messages match the row numbers on screen', () => {
  // The header is row 1, so the first data row is row 2. The review table and
  // the duplicate message both go through spreadsheetRow so they cannot drift.
  assert.equal(spreadsheetRow(0), 2);
  assert.equal(spreadsheetRow(5), 7);

  const { entries } = plan([
    ['Rivera, Marcus', '26-001', '2026-10-15', 'Open'],
    ['Rivera, Marcus', '26-001', '2026-11-20', 'Open'],
  ]);
  // Row index 1 renders as row 3; it points back at row index 0, which is row 2.
  assert.equal(spreadsheetRow(entries[1].rowIndex), 3);
  assert.match(entries[1].reason, /row 2 of this file/);
});

test('the summary counts what the screen has to show', () => {
  const matters = { abc: { values: { clientName: 'X', caseNumber: '26-001' } } };
  const { summary } = plan([
    ['Rivera, Marcus', '26-001', '2026-10-15', 'Open'],   // update
    ['Okafor, Ada', '26-002', '2026-12-01', 'Open'],      // create
    ['', '26-003', '', 'Open'],                            // skip
    ['Nguyen, Thanh', '26-004', 'ask Paul', 'Weird'],      // create, 2 warnings
  ], matters);

  assert.equal(summary.total, 4);
  assert.equal(summary.create, 2);
  assert.equal(summary.update, 1);
  assert.equal(summary.skip, 1);
  assert.equal(summary.withSol, 2);
  assert.equal(summary.warnings, 2);
});

test('nothing in planImport mutates the matters it was given', () => {
  const matters = { abc: { values: { clientName: 'X', caseNumber: '26-001' } } };
  const before = JSON.stringify(matters);
  plan([['Rivera, Marcus', '26-001', '2026-10-15', 'Open']], matters);
  assert.equal(JSON.stringify(matters), before);
});

test('the SOL count reflects the case after import, not just the file', () => {
  // A file that carries no SOL column does not remove the SOLs already on
  // file, so these cases must not be counted as missing one. Getting this
  // wrong would misreport the exact number the go-live check turns on.
  const cols = mapHeaders(['Client Name', 'Case Number', 'Served']);
  const matters = { abc: { values: { clientName: 'Rivera, Marcus', caseNumber: '26-001', sol: '2026-10-15' } } };
  const { entries, summary } = planImport({
    rows: [['Rivera, Marcus', '26-001', 'yes']],
    columns: cols,
    matters,
  });
  assert.equal(entries[0].action, 'update');
  assert.equal(entries[0].existingSol, '2026-10-15');
  assert.equal(summary.withSol, 1);
});

test('an update to a case that never had an SOL still counts as missing one', () => {
  const cols = mapHeaders(['Client Name', 'Case Number', 'Served']);
  const matters = { abc: { values: { clientName: 'Rivera, Marcus', caseNumber: '26-001' } } };
  const { summary } = planImport({
    rows: [['Rivera, Marcus', '26-001', 'yes']],
    columns: cols,
    matters,
  });
  assert.equal(summary.withSol, 0);
});

/* ------------------------------------------------------------------ *
 * splitProjectName — Filevine puts the case number IN the name
 * ------------------------------------------------------------------ */

test('a case number is lifted out of a combined project name', () => {
  assert.deepEqual(splitProjectName('Rivera, Marcus 26-033'),
    { clientName: 'Rivera, Marcus', caseNumber: '26-033' });
});

test('a qualifier after the number is kept on the name', () => {
  // "et al" and "2nd Case" are what tell two matters for the same client
  // apart. Dropping them merges records that must stay separate.
  assert.deepEqual(splitProjectName('Scott, Ashley 23-155 et al'),
    { clientName: 'Scott, Ashley et al', caseNumber: '23-155' });
});

test('the LAST number wins', () => {
  // Filevine appends the number, so anything numeric earlier is part of the
  // name rather than the identifier.
  assert.equal(splitProjectName('Hassan 21-064 and 22-011').caseNumber, '22-011');
});

test('a long digit run does not yield a case number', () => {
  // From the firm's real export: "Nguyen, Thanh*100007504 xx". A naive
  // \d{2}-\d{3} search on padded ids invents numbers that collide with
  // real cases, which is worse than finding none.
  assert.deepEqual(splitProjectName('Nguyen, Thanh*100007504 xx'),
    { clientName: 'Nguyen, Thanh*100007504 xx', caseNumber: '' });
  assert.equal(splitProjectName('ref 1234-5678').caseNumber, '');
});

test('a name with no number comes back whole', () => {
  assert.deepEqual(splitProjectName('Test, Test 2nd Case'),
    { clientName: 'Test, Test 2nd Case', caseNumber: '' });
  assert.deepEqual(splitProjectName('Barnett, Sarah 193'),
    { clientName: 'Barnett, Sarah 193', caseNumber: '' });
});

test('empty in, empty out', () => {
  assert.deepEqual(splitProjectName(''), { clientName: '', caseNumber: '' });
  assert.deepEqual(splitProjectName(null), { clientName: '', caseNumber: '' });
  assert.deepEqual(splitProjectName(undefined), { clientName: '', caseNumber: '' });
});

test('a name that is ONLY a case number keeps the number as the name', () => {
  // Better a case called "26-033" than one called "", which cannot be found.
  assert.deepEqual(splitProjectName('26-033'), { clientName: '26-033', caseNumber: '26-033' });
});

test('planImport splits the name when the file has no case-number column', () => {
  const columns = [{ index: 0, key: 'clientName', field: { key: 'clientName', label: 'Client Name' } }];
  const { entries } = planImport({ rows: [['Rivera, Marcus 26-033']], columns, matters: {} });
  assert.equal(entries[0].action, 'create');
  assert.equal(entries[0].values.clientName, 'Rivera, Marcus');
  assert.equal(entries[0].values.caseNumber, '26-033');
});

test('an explicit case-number column beats one embedded in the name', () => {
  /*
   * A stated column is an intention; a number scraped out of a name is an
   * inference. When they disagree the intention wins, and the name is left
   * exactly as typed rather than half-edited.
   */
  const columns = [
    { index: 0, key: 'clientName', field: { key: 'clientName', label: 'Client Name' } },
    { index: 1, key: 'caseNumber', field: { key: 'caseNumber', label: 'Case Number' } },
  ];
  const { entries } = planImport({ rows: [['Rivera, Marcus 26-033', '26-999']], columns, matters: {} });
  assert.equal(entries[0].values.caseNumber, '26-999');
  assert.equal(entries[0].values.clientName, 'Rivera, Marcus 26-033');
});

test('a split number matches an existing case instead of creating a second', () => {
  // The reason this matters: report two must land on the cases report one
  // made, or the firm ends up with 359 cases twice.
  const matters = { m1: { values: { clientName: 'Rivera, Marcus', caseNumber: '26-033' } } };
  const columns = [{ index: 0, key: 'clientName', field: { key: 'clientName', label: 'Client Name' } }];
  const { entries } = planImport({ rows: [['Rivera, Marcus 26-033']], columns, matters });
  assert.equal(entries[0].action, 'update');
  assert.equal(entries[0].matterId, 'm1');
});
