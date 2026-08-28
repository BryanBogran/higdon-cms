import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseMoney, formatMoney, percentOf, totalExpenses, totalLiens,
  applyReduction, buildLines,
  computeSettlement, statementLines, FEE_BASIS, EXPENSE_BASIS,
} from './settlement.js';

/* ------------------------------------------------------------------ *
 * Parsing
 * ------------------------------------------------------------------ */

test('money strings become integer cents, however they were typed', () => {
  assert.equal(parseMoney('1234.56'), 123456);
  assert.equal(parseMoney('$1,234.56'), 123456);
  assert.equal(parseMoney(' 1234 '), 123400);
  assert.equal(parseMoney('.5'), 50);
  assert.equal(parseMoney('0.29'), 29, 'parseFloat("0.29")*100 is 28.999999999999996');
  assert.equal(parseMoney(1234.56), 123456);
});

test('an absent amount is null, and zero is zero', () => {
  // A blank lien is unknown; a zero lien is settled for nothing. Collapsing
  // them would let an empty field read as a resolved debt.
  assert.equal(parseMoney(''), null);
  assert.equal(parseMoney(null), null);
  assert.equal(parseMoney(undefined), null);
  assert.equal(parseMoney('  '), null);
  assert.equal(parseMoney('0'), 0);
  assert.equal(parseMoney('$0.00'), 0);
});

test('junk is null, not a confident wrong number', () => {
  assert.equal(parseMoney('n/a'), null);
  assert.equal(parseMoney('TBD'), null);
  assert.equal(parseMoney('-'), null);
  assert.equal(parseMoney('12.34.56'), null);
});

test('accounting negatives and minus signs both work', () => {
  assert.equal(parseMoney('-500.00'), -50000);
  assert.equal(parseMoney('(500.00)'), -50000);
  assert.equal(parseMoney('($1,500.25)'), -150025);
});

test('a third decimal rounds the cent, half away from zero', () => {
  assert.equal(parseMoney('10.004'), 1000);
  assert.equal(parseMoney('10.005'), 1001);
  assert.equal(parseMoney('10.999'), 1100);
});

test('formatting is the exact inverse for whole cents', () => {
  assert.equal(formatMoney(123456), '$1,234.56');
  assert.equal(formatMoney(0), '$0.00');
  assert.equal(formatMoney(5), '$0.05');
  assert.equal(formatMoney(-150025), '-$1,500.25');
  assert.equal(formatMoney(100000000), '$1,000,000.00');
  assert.equal(formatMoney(null), '—', 'absent is not zero on screen either');
});

/* ------------------------------------------------------------------ *
 * The property that matters
 * ------------------------------------------------------------------ */

test('THE COLUMNS RECONCILE EXACTLY — no cent is created or lost', () => {
  // The whole reason this file uses integers. A third of $100,000.01 is not a
  // whole number of cents, so the fee must round -- and the residual has to
  // land in the client's column rather than vanishing.
  const r = computeSettlement({
    gross: '100000.01',
    feePercent: 33.333,
    medicalRows: [{ id: 'm1', provider: 'A', amount: '7777.77' }],
    expenseRows: [{ id: 'e1', amountofinvoice: '1234.57' }, { id: 'e2', amountofinvoice: '89.99' }],
    lienRows: [{ amount: '5000.33' }],
    includeLiens: true,
    reductions: { m1: 33 },
  });
  assert.equal(
    r.grossCents - r.feeCents - r.medicalCents - r.expenseCents - r.lienCents - r.otherCents,
    r.netToClientCents
  );
});

test('a float implementation would drift here; this one does not', () => {
  // Ten rows of $0.10 and $0.20. In floats these accumulate to 2.9999...
  const rows = Array.from({ length: 10 }, () => [{ amountofinvoice: '0.10' }, { amountofinvoice: '0.20' }]).flat();
  assert.equal(totalExpenses(rows).cents, 300, 'exactly $3.00');
});

test('percentages round once, half away from zero', () => {
  assert.equal(percentOf(10000, 33.333), 3333);
  assert.equal(percentOf(100001, 33.333), 33333);
  assert.equal(percentOf(3, 50), 2, '1.5 cents rounds away from zero');
  assert.equal(percentOf(-3, 50), -2, 'and symmetrically for negatives');
  assert.equal(percentOf(10000, 40), 4000);
  assert.equal(percentOf(1, 50), 1, 'half a cent rounds up, not to zero');
  assert.equal(percentOf(0, 40), 0);
});

/* ------------------------------------------------------------------ *
 * A worked example
 * ------------------------------------------------------------------ */

test("a hand-worked settlement, in Filevine's shape", () => {
  // Offer $75,000 · Attorney 40% · Medical Bills $8,400 reduced 25% · Expenses $2,150
  const r = computeSettlement({
    gross: '75,000.00',
    feePercent: 40,
    medicalRows: [{ id: 'm1', provider: 'Northside Urgent Care', amount: '8400.00' }],
    expenseRows: [
      { id: 'e1', description: 'Records', amountofinvoice: '1500.00' },
      { id: 'e2', description: 'Filing fee', amountofinvoice: '650.00' },
    ],
    reductions: { m1: 25 },
  });
  assert.equal(r.grossCents, 7500000);
  assert.equal(r.feeCents, 3000000, '40% of 75,000');
  assert.equal(r.medicalCents, 630000, '8,400 less 25%');
  assert.equal(r.medicalOriginalCents, 840000);
  assert.equal(r.expenseCents, 215000);
  assert.equal(r.netToClientCents, 3655000, '75,000 - 30,000 - 6,300 - 2,150');
  assert.equal(formatMoney(r.netToClientCents), '$36,550.00');
});

test('liens are NOT deducted by default — that would double-count the bills', () => {
  // On a PI file the provider bills usually ARE the liens. Filevine deducts
  // Medical Bills and not liens, and taking both would remove the same money
  // from the client twice.
  const args = {
    gross: '10000',
    feePercent: 0,
    medicalRows: [{ id: 'm1', provider: 'Clinic', amount: '2000' }],
    lienRows: [{ amount: '2000' }],
  };
  const off = computeSettlement(args);
  const on = computeSettlement({ ...args, includeLiens: true });

  assert.equal(off.lienCents, 0);
  assert.equal(off.netToClientCents, 800000, '10,000 - 2,000 medical');
  assert.equal(on.netToClientCents, 600000, 'opt in and the lien comes off too');
  assert.ok(!statementLines(off).some((l) => l.label.startsWith('Liens')), 'no line when off');
  assert.ok(statementLines(on).some((l) => l.label.startsWith('Liens')), 'a line when on');
});

test('a per-line reduction is a percentage, and is clamped', () => {
  assert.equal(applyReduction(10000, 25), 7500);
  assert.equal(applyReduction(10000, 0), 10000);
  assert.equal(applyReduction(10000, 100), 0);
  // Over 100% would pay the client out of the provider's pocket; under zero
  // would inflate the bill. Both are typos, not negotiations.
  assert.equal(applyReduction(10000, 150), 0);
  assert.equal(applyReduction(10000, -50), 10000);
  assert.equal(applyReduction(10000, 'abc'), 10000, 'junk means no reduction');
});

test('line items carry the original, the percentage and the reduced figure', () => {
  const built = buildLines(
    [
      { id: 'a', provider: 'Clinic A', amount: '2000.00' },
      { id: 'b', provider: 'Clinic B', amount: '1000.00' },
      { id: 'c', amount: '' },
    ],
    { labelKeys: ['provider'], amountKey: 'amount', reductions: { a: 50 } }
  );
  assert.equal(built.lines.length, 2);
  assert.equal(built.lines[0].label, 'Clinic A');
  assert.equal(built.lines[0].originalCents, 200000);
  assert.equal(built.lines[0].percent, 50);
  assert.equal(built.lines[0].reducedCents, 100000);
  assert.equal(built.originalCents, 300000);
  assert.equal(built.reducedCents, 200000);
  assert.equal(built.missing, 1, 'the blank row is counted, not totalled as zero');
});

test('a line with no usable label still shows something', () => {
  const built = buildLines([{ id: 'x', amount: '100' }], { labelKeys: ['provider'], amountKey: 'amount' });
  assert.equal(built.lines[0].label, 'Unnamed');
});

test('the fee basis changes what the client gets, so it is explicit', () => {
  const args = { gross: '100000', feePercent: 40, expenseRows: [{ amountofinvoice: '10000' }] };
  const onGross = computeSettlement({ ...args, feeBasis: FEE_BASIS.GROSS });
  const onNet = computeSettlement({ ...args, feeBasis: FEE_BASIS.NET_OF_EXPENSES });

  assert.equal(onGross.feeCents, 4000000);
  assert.equal(onNet.feeCents, 3600000, '40% of 90,000');
  assert.equal(onNet.netToClientCents - onGross.netToClientCents, 400000, '$4,000 to the client');
});

test('the expense basis picks invoiced or actually paid', () => {
  const rows = [{ amountofinvoice: '1000', amountpaid: '400' }];
  assert.equal(totalExpenses(rows, EXPENSE_BASIS.INVOICED).cents, 100000);
  assert.equal(totalExpenses(rows, EXPENSE_BASIS.PAID).cents, 40000);
});

/* ------------------------------------------------------------------ *
 * Refusing to be confidently wrong
 * ------------------------------------------------------------------ */

test('a missing amount is reported, not silently totalled as zero', () => {
  const e = totalExpenses([{ amountofinvoice: '100' }, { amountofinvoice: '' }, {}]);
  assert.equal(e.cents, 10000);
  assert.equal(e.missing, 2);

  const r = computeSettlement({ gross: '50000', expenseRows: [{ amountofinvoice: '' }] });
  assert.match(r.warnings.join(' '), /no readable amount/);
});

test('a lien with no amount warns that the net is too high — when liens are on', () => {
  const r = computeSettlement({ gross: '50000', lienRows: [{ amount: '' }], includeLiens: true });
  assert.match(r.warnings.join(' '), /too high/);
});

test('a medical row with no amount is reported too', () => {
  const r = computeSettlement({ gross: '50000', medicalRows: [{ id: 'm1', provider: 'X', amount: '' }] });
  assert.match(r.warnings.join(' '), /medical provider row/);
});

test('no gross means no statement, not a confident row of zeroes', () => {
  const r = computeSettlement({ gross: '', lienRows: [{ amount: '100' }] });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-gross');
  assert.equal(r.netToClientCents, null, 'null, never 0');
  assert.deepEqual(statementLines(r), []);
});

test('a negative net is shown and flagged, never clamped to zero', () => {
  // Clamping would hide that the file is short, which is the one thing
  // somebody needs to know before this reaches a client.
  const r = computeSettlement({ gross: '10000', feePercent: 40, lienRows: [{ amount: '20000' }], includeLiens: true });
  assert.ok(r.netToClientCents < 0);
  assert.match(r.warnings.join(' '), /exceed the settlement/);
});

test('a reduction larger than the lien cannot pay the client', () => {
  // That is a typo, not a negotiation. Payable floors at zero.
  const t = totalLiens([{ amount: '1000', reduction: '5000' }]);
  assert.equal(t.cents, 0);
});

test('an absurd fee percentage is questioned', () => {
  const r = computeSettlement({ gross: '10000', feePercent: 75 });
  assert.match(r.warnings.join(' '), /unusually high/);
});

test('an empty case computes cleanly', () => {
  const r = computeSettlement({ gross: '10000' });
  assert.equal(r.expenseCents, 0);
  assert.equal(r.lienCents, 0);
  assert.deepEqual(r.warnings, []);
  assert.equal(computeSettlement().ok, false);
});

test("the statement uses Filevine's own words", () => {
  const r = computeSettlement({ gross: '10000', feePercent: 40 });
  const labels = statementLines(r).map((l) => l.label);
  assert.equal(labels[0], 'Offer');
  assert.equal(labels.at(-1), 'Total to Client');
  assert.ok(labels.some((l) => l.startsWith('Attorney 40%')));
  assert.ok(labels.some((l) => l.startsWith('Medical Bills')));
});

test('the statement reads gross, deductions, net — in that order', () => {
  const r = computeSettlement({ gross: '10000', feePercent: 40 });
  const lines = statementLines(r);
  assert.equal(lines[0].kind, 'total');
  assert.equal(lines.at(-1).kind, 'net');
  // Deductions carry their sign, so a reader adding the column down reaches
  // the net -- which is why the net row itself is excluded from the sum.
  const above = lines.slice(0, -1).reduce((sum, l) => sum + l.cents, 0);
  assert.equal(above, r.netToClientCents);
});
