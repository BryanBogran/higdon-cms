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

/**
 * Apply a percentage reduction to an amount, in cents.
 *
 * Filevine's calculator negotiates each medical bill and expense down by a
 * PERCENTAGE, per line, entered in the calculator rather than on the Meds row —
 * the reduction is a negotiation outcome, not a property of the bill.
 *
 * Clamped to 0–100. A reduction over 100% would pay the client out of the
 * provider's pocket, and a negative one would inflate the bill; both are typos,
 * not negotiations.
 */
export function applyReduction(cents, percent) {
  if (!Number.isFinite(cents)) return 0;
  const pct = Math.min(100, Math.max(0, Number(percent) || 0));
  return cents - percentOf(cents, pct);
}

/**
 * Line items for one of the calculator's deduction tables.
 *
 * `reductions` is `{ [rowId]: percent }`, stored on the calculator rather than
 * on the source row, so negotiating a bill down never edits the Meds or
 * Expenses record of what was originally charged.
 */
export function buildLines(rows = [], {
  labelKeys = [], amountKey, reductions = {}, overrides = {},
} = {}) {
  const lines = [];
  let billedCents = 0;
  let originalCents = 0;
  let reducedCents = 0;
  let missing = 0;

  for (const row of rows) {
    const billed = parseMoney(row?.[amountKey]);

    /*
     * ── THE OVERRIDE ─────────────────────────────────────────────────────
     *
     * A dollar figure the calculator uses INSTEAD of what the section row
     * says, stored on the settlement rather than on the Meds row. The firm
     * asked to "change the values in the settlement calculator without
     * affecting the bills": the bill is a fact about what a provider charged,
     * the settlement figure is the outcome of a negotiation, and writing the
     * second over the first loses the first.
     *
     * ORDER: the override replaces the billed amount, and the reduction
     * percentage then applies to it. 6,000 billed → 5,000 used → less 10% =
     * 4,500. Both controls keep the meaning they already had, so neither
     * needs a special case.
     *
     * `parseMoney` returning null means "not a number I can read", which is
     * how a half-typed or cleared override falls back to the bill instead of
     * silently becoming zero.
     */
    const override = parseMoney(overrides[row.id]);
    const original = override === null ? billed : override;

    if (original === null) {
      missing++;
      continue;
    }
    const percent = Number(reductions[row.id]) || 0;
    const reduced = applyReduction(original, percent);
    const label =
      labelKeys.map((k) => row?.[k]).find((v) => v && String(v).trim()) || 'Unnamed';

    lines.push({
      id: row.id,
      label: String(label),
      // What the section says, kept so the UI can show billed → used and the
      // substitution is visible rather than mysterious.
      billedCents: billed,
      overriddenCents: override,
      originalCents: original,
      percent,
      reducedCents: reduced,
    });
    billedCents += billed === null ? 0 : billed;
    originalCents += original;
    reducedCents += reduced;
  }

  return { lines, billedCents, originalCents, reducedCents, missing, count: rows.length };
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
  medicalRows = [],
  expenseRows = [],
  expenseBasis = EXPENSE_BASIS.INVOICED,
  lienRows = [],
  includeLiens = false,
  reductions = {},
  // Per-line dollar amounts that replace what the section row says. Keyed by
  // row id, exactly like `reductions`, and stored in the same place.
  overrides = {},
  otherDeductions = [],
} = {}) {
  const grossCents = parseMoney(gross);

  // Medical bills, from the Meds section. Filevine deducts THESE rather than
  // liens — on a PI file the provider bills usually are the liens, and
  // deducting both would take the same money off the client twice. Liens stay
  // available as a separate opt-in line for the cases where they are distinct.
  const medicals = buildLines(medicalRows, {
    labelKeys: ['provider', 'personbeingtreated'],
    amountKey: 'amount',
    reductions,
    overrides,
  });

  const expenseLines = buildLines(expenseRows, {
    labelKeys: ['description', 'payeename', 'type'],
    amountKey: expenseBasis === EXPENSE_BASIS.PAID ? 'amountpaid' : 'amountofinvoice',
    reductions,
  });

  const expenses = { cents: expenseLines.reducedCents, missing: expenseLines.missing, count: expenseLines.count };
  const liens = includeLiens
    ? totalLiens(lienRows)
    : { cents: 0, missing: 0, count: lienRows.length, reducedCents: 0 };

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
      medicalCents: medicals.reducedCents,
      expenseCents: expenses.cents,
      lienCents: liens.cents,
      otherCents,
      netToClientCents: null,
      medicals,
      expenseLines,
      feeBasis,
      expenseBasis,
      feePercent,
      includeLiens,
      warnings: buildWarnings({ expenses, liens, medicals, grossCents: null, netCents: null, feePercent }),
    };
  }

  const feeBaseCents =
    feeBasis === FEE_BASIS.NET_OF_EXPENSES ? grossCents - expenses.cents : grossCents;
  const feeCents = percentOf(feeBaseCents, feePercent);

  // Subtraction, not accumulation. Whatever the fee rounding did, the residual
  // is inside this number rather than lost between two independent totals.
  const netToClientCents =
    grossCents - feeCents - medicals.reducedCents - expenses.cents - liens.cents - otherCents;

  return {
    ok: true,
    grossCents,
    feeBaseCents,
    feeCents,
    medicalCents: medicals.reducedCents,
    medicalOriginalCents: medicals.originalCents,
    expenseCents: expenses.cents,
    expenseOriginalCents: expenseLines.originalCents,
    lienCents: liens.cents,
    lienReducedCents: liens.reducedCents,
    otherCents,
    netToClientCents,
    medicals,
    expenseLines,
    feeBasis,
    expenseBasis,
    feePercent,
    includeLiens,
    counts: { medicals: medicals.count, expenses: expenses.count, liens: liens.count },
    warnings: buildWarnings({ expenses, liens, medicals, grossCents, netCents: netToClientCents, feePercent }),
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
function buildWarnings({ expenses, liens, medicals, grossCents, netCents, feePercent }) {
  const out = [];

  if (medicals?.missing > 0) {
    out.push(`${medicals.missing} medical provider row${medicals.missing === 1 ? ' has' : 's have'} no amount and ${medicals.missing === 1 ? 'is' : 'are'} not included.`);
  }

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
  // Labels follow Filevine's own calculator: Offer, Attorney %, Medical Bills,
  // Expenses, Total to Client. Staff read this sheet to a client, and matching
  // the words they already say is the point of the whole clone.
  return [
    { label: 'Offer', cents: result.grossCents, kind: 'total' },
    {
      label: `Attorney ${result.feePercent}%${result.feeBasis === FEE_BASIS.NET_OF_EXPENSES ? ' (of net of expenses)' : ''}`,
      cents: -result.feeCents,
      kind: 'deduction',
    },
    {
      label: `Medical Bills (${result.counts.medicals} provider${result.counts.medicals === 1 ? '' : 's'})`,
      cents: -result.medicalCents,
      kind: 'deduction',
    },
    {
      label: `Expenses (${result.counts.expenses} item${result.counts.expenses === 1 ? '' : 's'})`,
      cents: -result.expenseCents,
      kind: 'deduction',
    },
    ...(result.includeLiens
      ? [{ label: `Liens (${result.counts.liens} item${result.counts.liens === 1 ? '' : 's'})`, cents: -result.lienCents, kind: 'deduction' }]
      : []),
    ...(result.otherCents ? [{ label: 'Other deductions', cents: -result.otherCents, kind: 'deduction' }] : []),
    { label: 'Total to Client', cents: result.netToClientCents, kind: 'net' },
  ];
}
