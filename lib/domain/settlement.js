/**
 * SETTLEMENT MATH.
 *
 * The number this produces is what a client is handed a cheque for, so two
 * rules govern the whole file.
 *
 * ── 1. INTEGER CENTS. NEVER FLOATS. ───────────────────────────────────────
 *
 *   0.1 + 0.2 === 0.30000000000000004
 *
 * Binary floating point cannot represent most decimal fractions, so a chain of
 * float additions drifts. On a disbursement statement that surfaces as a total
 * that does not match its own line items, and the firm's answer to "why is this
 * a penny out" is that its software cannot add up. Everything here is an
 * integer number of cents and only becomes a decimal string at display time.
 *
 * ── 2. THE PARTS MUST SUM TO THE WHOLE. ───────────────────────────────────
 *
 * Net is computed by SUBTRACTION from gross, never accumulated independently.
 * The attorney fee is the one figure that needs rounding — a third of an odd
 * amount is not a whole number of cents — and because net is what is left after
 * it, whichever way that cent rounds it lands in the client's column rather
 * than vanishing. There is a test asserting the columns reconcile exactly.
 *
 * ── What this is NOT ──────────────────────────────────────────────────────
 *
 * Not legal advice, and not a substitute for the fee agreement. Two things
 * genuinely vary between firms and even between cases, so both are options
 * rather than assumptions, and both are surfaced in the UI:
 *
 *   - whether the fee is calculated on the GROSS settlement or on the gross
 *     less case expenses
 *   - whether expenses are recouped at the amount INVOICED or the amount the
 *     firm has actually paid out so far
 *
 * Getting either backwards changes what the client receives, so the calculator
 * shows which basis it used rather than quietly picking one.
 */

/**
 * A money string to integer cents, or null when there is no value at all.
 *
 * `null` and `0` are different answers and are kept different: an empty lien
 * amount is unknown, a zero lien amount is resolved for nothing. Collapsing
 * them would let a blank field read as a settled debt.
 */
export function parseMoney(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.round(value * 100) : null;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  // Accounting negatives: (1,234.56) means -1234.56.
  const parenthesised = /^\((.*)\)$/.exec(raw);
  const inner = parenthesised ? parenthesised[1] : raw;

  const cleaned = inner.replace(/[$\s,]/g, '');
  if (!/^-?\d*\.?\d*$/.test(cleaned) || cleaned === '' || cleaned === '-' || cleaned === '.') {
    return null;
  }

  const negative = parenthesised || cleaned.startsWith('-');
  const [whole, fraction = ''] = cleaned.replace(/^-/, '').split('.');

  // Built from digits rather than parseFloat: parseFloat('0.29') * 100 is
  // 28.999999999999996, and Math.round would rescue that one but not all of
  // them. Reading the digits cannot drift at all.
  const cents =
    Number(whole || '0') * 100 + Number((fraction + '00').slice(0, 2)) +
    // A third decimal place rounds the cent, half away from zero.
    (Number(fraction[2] || '0') >= 5 ? 1 : 0);

  if (!Number.isFinite(cents)) return null;
  return negative ? -cents : cents;
}

/** Integer cents to "$1,234.56". */
export function formatMoney(cents, { blank = '—' } = {}) {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return blank;
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}$${whole}.${frac}`;
}

/**
 * A percentage of an amount, in cents, rounded half away from zero.
 *
 * `percent` is a number like 33.333 or 40. Multiplied out in a single
 * expression so there is exactly one rounding step — chaining two roundings is
 * how a figure ends up a cent adrift from the same figure computed elsewhere.
 */
export function percentOf(cents, percent) {
  if (!Number.isFinite(cents) || !Number.isFinite(percent)) return 0;
  const exact = (cents * percent) / 100;
  return exact < 0 ? -Math.round(-exact) : Math.round(exact);
}

/** Texas contingency fees in practice. Free text is still allowed. */
export const COMMON_FEE_PERCENTS = [33.333, 35, 40, 45];

export const FEE_BASIS = {
  GROSS: 'gross',
  NET_OF_EXPENSES: 'net-of-expenses',
};

export const EXPENSE_BASIS = {
  INVOICED: 'invoiced',
  PAID: 'paid',
};

/**
 * Total the Expenses section's rows.
 *
 * Returns cents plus the count of rows that carried no readable amount, so the
 * UI can say "3 expenses have no amount" instead of quietly totalling them as
 * zero. A missing number is not a zero, and on a disbursement statement the
 * difference is money.
 */
export function totalExpenses(rows = [], basis = EXPENSE_BASIS.INVOICED) {
  const key = basis === EXPENSE_BASIS.PAID ? 'amountpaid' : 'amountofinvoice';
  let cents = 0;
  let missing = 0;
  for (const row of rows) {
    const value = parseMoney(row?.[key]);
    if (value === null) missing++;
    else cents += value;
  }
  return { cents, missing, count: rows.length };
}

/**
 * Total the Liens section's rows, honouring negotiated reductions.
 *
 * Filevine's own Liens section carries `Reduced By = Amount - Reduction` as a
 * calculated column — found in the API capture, not invented — so a reduction
 * field is respected where present.
 */
export function totalLiens(rows = []) {
  let cents = 0;
  let missing = 0;
  let reducedCents = 0;
  for (const row of rows) {
    const amount = parseMoney(row?.amount);
    if (amount === null) {
      missing++;
      continue;
    }
    const reduction = parseMoney(row?.reduction) || 0;
    // A reduction cannot exceed the lien: that would pay the client out of the
    // lienholder's pocket, which is a typo, not a negotiation.
    const payable = Math.max(0, amount - Math.max(0, reduction));
    cents += payable;
    reducedCents += amount - payable;
  }
  return { cents, missing, count: rows.length, reducedCents };
}

/**
 * The disbursement breakdown.
 *
 * Every figure is integer cents. `netToClient` is a subtraction from gross, so
 * the columns always reconcile — see the test that asserts it.
 */
export function computeSettlement({
  gross,
  feePercent = 33.333,
  feeBasis = FEE_BASIS.GROSS,
  expenseRows = [],
  expenseBasis = EXPENSE_BASIS.INVOICED,
  lienRows = [],
  otherDeductions = [],
} = {}) {
  const grossCents = parseMoney(gross);
  const expenses = totalExpenses(expenseRows, expenseBasis);
  const liens = totalLiens(lienRows);

  let otherCents = 0;
  for (const d of otherDeductions) otherCents += parseMoney(d?.amount) || 0;

  // No gross means no statement. Zeroes here would render a confident,
  // meaningless breakdown; nulls make the UI say the number is missing.
  if (grossCents === null) {
    return {
      ok: false,
      reason: 'no-gross',
      grossCents: null,
      feeCents: null,
      expenseCents: expenses.cents,
      lienCents: liens.cents,
      otherCents,
      netToClientCents: null,
      feeBasis,
      expenseBasis,
      feePercent,
      warnings: buildWarnings({ expenses, liens, grossCents: null, netCents: null, feePercent }),
    };
  }

  const feeBaseCents =
    feeBasis === FEE_BASIS.NET_OF_EXPENSES ? grossCents - expenses.cents : grossCents;
  const feeCents = percentOf(feeBaseCents, feePercent);

  // Subtraction, not accumulation. Whatever the fee rounding did, the residual
  // is inside this number rather than lost between two independent totals.
  const netToClientCents = grossCents - feeCents - expenses.cents - liens.cents - otherCents;

  return {
    ok: true,
    grossCents,
    feeBaseCents,
    feeCents,
    expenseCents: expenses.cents,
    lienCents: liens.cents,
    lienReducedCents: liens.reducedCents,
    otherCents,
    netToClientCents,
    feeBasis,
    expenseBasis,
    feePercent,
    counts: { expenses: expenses.count, liens: liens.count },
    warnings: buildWarnings({ expenses, liens, grossCents, netCents: netToClientCents, feePercent }),
  };
}

/**
 * Things a human must look at before this goes to a client.
 *
 * Warnings, never corrections. The calculator does not silently clamp a
 * negative net or drop an unreadable amount — it says so and leaves the
 * numbers alone, the same way checkBadDate flags a weekend deadline rather
 * than moving it.
 */
function buildWarnings({ expenses, liens, grossCents, netCents, feePercent }) {
  const out = [];

  if (expenses.missing > 0) {
    out.push(`${expenses.missing} expense row${expenses.missing === 1 ? ' has' : 's have'} no readable amount and ${expenses.missing === 1 ? 'is' : 'are'} not included.`);
  }
  if (liens.missing > 0) {
    out.push(`${liens.missing} lien${liens.missing === 1 ? '' : 's'} ${liens.missing === 1 ? 'has' : 'have'} no amount yet — the net below is too high until ${liens.missing === 1 ? 'it is' : 'they are'} filled in.`);
  }
  if (netCents !== null && netCents < 0) {
    out.push('Deductions exceed the settlement. The client would receive nothing and the file is short — check the lien figures.');
  }
  if (grossCents !== null && grossCents <= 0) {
    out.push('The gross settlement is zero or negative.');
  }
  if (feePercent > 50) {
    out.push(`A ${feePercent}% fee is unusually high — confirm it against the fee agreement.`);
  }
  return out;
}

/** Rows for a disbursement statement, in the order they are read out. */
export function statementLines(result) {
  if (!result?.ok) return [];
  return [
    { label: 'Gross settlement', cents: result.grossCents, kind: 'total' },
    {
      label: `Attorney fee (${result.feePercent}%${result.feeBasis === FEE_BASIS.NET_OF_EXPENSES ? ' of net of expenses' : ''})`,
      cents: -result.feeCents,
      kind: 'deduction',
    },
    {
      label: `Case expenses (${result.counts.expenses} item${result.counts.expenses === 1 ? '' : 's'})`,
      cents: -result.expenseCents,
      kind: 'deduction',
    },
    {
      label: `Liens (${result.counts.liens} item${result.counts.liens === 1 ? '' : 's'})`,
      cents: -result.lienCents,
      kind: 'deduction',
    },
    ...(result.otherCents ? [{ label: 'Other deductions', cents: -result.otherCents, kind: 'deduction' }] : []),
    { label: 'Net to client', cents: result.netToClientCents, kind: 'net' },
  ];
}
