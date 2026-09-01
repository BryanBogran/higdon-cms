'use client';

/**
 * Settlement Calculator — gross to net-to-client.
 *
 * Every figure comes from somewhere the firm already maintains: the gross is
 * the matter's Settlement Amount, expenses are the Expenses section's rows,
 * liens are the Liens section's rows. Nothing is re-keyed, so this page cannot
 * disagree with those sections — and if a number looks wrong, it is wrong at
 * its source, which is where it gets fixed.
 *
 * The arithmetic is in lib/domain/settlement.js, in integer cents, with 20
 * tests. It is not in this file, because this number is what a client is handed
 * a cheque for and it deserves to be testable without a browser.
 *
 * Two things this refuses to do quietly:
 *   - total a row whose amount is unreadable as if it were zero
 *   - clamp a negative net to zero
 * Both are surfaced as warnings. The second especially: a negative net means
 * the file is short, and that is the one thing somebody must know before this
 * reaches a client.
 */

import { useMemo } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { useData } from '@/lib/data/DataProvider';
import {
  computeSettlement, statementLines, formatMoney,
  COMMON_FEE_PERCENTS, FEE_BASIS, EXPENSE_BASIS,
} from '@/lib/domain/settlement';
import { FIELDS } from '@/lib/domain/fields';
import FieldInput from './FieldInput';

const KEY = 'settlement-calculator';
const OWN_FIELDS = FIELDS.filter((f) => f.section === 'Settlement Calculator' && f.key !== 'settlementAmount');

export default function SettlementCalculatorSection({ matterId, matter }) {
  const { sectionState, setSectionField, updateMatterField } = useData();

  const settings = sectionState(matterId, KEY).fields;
  const medicalRows = sectionState(matterId, 'meds').rows;
  const expenseRows = sectionState(matterId, 'expenses').rows;
  const lienRows = sectionState(matterId, 'liens').rows;

  const feePercent = Number(settings.feePercent ?? 33.333);
  const feeBasis = settings.feeBasis || FEE_BASIS.GROSS;
  const expenseBasis = settings.expenseBasis || EXPENSE_BASIS.INVOICED;
  const includeLiens = settings.includeLiens === true;
  // Per-line reduction percentages live HERE, not on the Meds or Expenses row:
  // negotiating a bill down is an outcome of this calculation, and must never
  // edit the record of what was originally charged.
  const reductions = settings.reductions || {};

  const setReduction = (rowId, percent) =>
    setSectionField(matterId, KEY, 'reductions', { ...reductions, [rowId]: percent });

  const result = useMemo(
    () =>
      computeSettlement({
        gross: matter?.values?.settlementAmount,
        feePercent,
        feeBasis,
        medicalRows,
        expenseRows,
        expenseBasis,
        lienRows,
        includeLiens,
        reductions,
      }),
    [matter?.values?.settlementAmount, feePercent, feeBasis, medicalRows, expenseRows,
     expenseBasis, lienRows, includeLiens, reductions]
  );

  const lines = statementLines(result);

  return (
    <div className="space-y-6">
      <div className="bg-surface rounded-xl border border-line shadow-sm">
        <div className="px-5 py-3 border-b border-line-soft">
          <h2 className="font-semibold text-ink">Inputs</h2>
        </div>
        <div className="p-5 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-4 mb-1">
              Offer
            </label>
            <input
              className="input"
              placeholder="$0.00"
              value={matter?.values?.settlementAmount || ''}
              onChange={(e) => updateMatterField(matterId, 'settlementAmount', e.target.value)}
            />
            <p className="mt-1 text-xs text-ink-3">
              The matter&apos;s Settlement Amount. Editing it here edits it everywhere.
            </p>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-4 mb-1">
              Attorney %
            </label>
            <input
              className="input"
              type="number"
              step="0.001"
              list="fee-percents"
              value={settings.feePercent ?? 33.333}
              onChange={(e) => setSectionField(matterId, KEY, 'feePercent', e.target.value)}
            />
            <datalist id="fee-percents">
              {COMMON_FEE_PERCENTS.map((p) => <option key={p} value={p} />)}
            </datalist>
          </div>

          {/*
            Both of these change what the client receives, so neither is
            assumed. Fee agreements genuinely differ on both counts, and the
            statement below states which basis it used.
          */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-4 mb-1">
              Fee calculated on
            </label>
            <select
              className="input"
              value={feeBasis}
              onChange={(e) => setSectionField(matterId, KEY, 'feeBasis', e.target.value)}
            >
              <option value={FEE_BASIS.GROSS}>Gross settlement</option>
              <option value={FEE_BASIS.NET_OF_EXPENSES}>Gross less case expenses</option>
            </select>
            <p className="mt-1 text-xs text-ink-3">Check the fee agreement — the two differ.</p>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-4 mb-1">
              Also deduct liens
            </label>
            <select
              className="input"
              value={includeLiens ? 'yes' : 'no'}
              onChange={(e) => setSectionField(matterId, KEY, 'includeLiens', e.target.value === 'yes')}
            >
              <option value="no">No — medical bills already cover them</option>
              <option value="yes">Yes — liens are separate on this file</option>
            </select>
            <p className="mt-1 text-xs text-ink-3">
              Off by default. On a PI file the provider bills usually are the liens, and
              deducting both takes the same money off the client twice.
            </p>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-4 mb-1">
              Expenses recouped at
            </label>
            <select
              className="input"
              value={expenseBasis}
              onChange={(e) => setSectionField(matterId, KEY, 'expenseBasis', e.target.value)}
            >
              <option value={EXPENSE_BASIS.INVOICED}>Amount invoiced</option>
              <option value={EXPENSE_BASIS.PAID}>Amount actually paid</option>
            </select>
          </div>

          {OWN_FIELDS.map((f) => (
            <div key={f.key} className={f.type === 'textarea' ? 'sm:col-span-2' : ''}>
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-4 mb-1">
                {f.label}
              </label>
              <FieldInput
                field={f}
                value={matter?.values?.[f.key]}
                onChange={(val) => updateMatterField(matterId, f.key, val)}
              />
            </div>
          ))}
        </div>
      </div>

      {result.warnings.length ? (
        <div className="rounded-xl border border-warn-line bg-warn-bg p-4 space-y-1.5">
          {result.warnings.map((w, i) => (
            <p key={i} className="flex items-start gap-1.5 text-sm text-warn-ink-strong">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {w}
            </p>
          ))}
        </div>
      ) : null}

      <div className="bg-surface rounded-xl border border-line shadow-sm">
        <div className="px-5 py-3 border-b border-line-soft">
          <h2 className="font-semibold text-ink">Disbursement</h2>
        </div>

        {!result.ok ? (
          <p className="px-5 py-10 text-center text-sm text-ink-4">
            Enter a gross settlement amount above.
          </p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {lines.map((l, i) => (
                <tr
                  key={i}
                  className={`border-b border-line-soft last:border-0 ${
                    l.kind === 'net' ? 'bg-canvas font-semibold' : ''
                  }`}
                >
                  <td className="px-5 py-2.5 text-ink-2">{l.label}</td>
                  <td
                    className={`px-5 py-2.5 text-right tabular-nums ${
                      l.kind === 'net'
                        ? l.cents < 0 ? 'text-danger-ink' : 'text-ink'
                        : l.kind === 'deduction' ? 'text-ink-2' : 'text-ink'
                    }`}
                  >
                    {formatMoney(l.cents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="px-5 py-3 border-t border-line-soft flex flex-wrap gap-4 text-xs text-ink-3">
          <Link href={`/matters/${matterId}/medicals`} className="flex items-center gap-1 text-accent-ink hover:underline">
            {result.counts?.medicals ?? 0} provider{(result.counts?.medicals ?? 0) === 1 ? '' : 's'} <ArrowRight size={12} />
          </Link>
          <Link href={`/matters/${matterId}/expenses`} className="flex items-center gap-1 text-accent-ink hover:underline">
            {result.counts?.expenses ?? 0} expense row{(result.counts?.expenses ?? 0) === 1 ? '' : 's'} <ArrowRight size={12} />
          </Link>
          <Link href={`/matters/${matterId}/liens`} className="flex items-center gap-1 text-accent-ink hover:underline">
            {result.counts?.liens ?? 0} lien{(result.counts?.liens ?? 0) === 1 ? '' : 's'}
            {includeLiens ? '' : ' (not deducted)'} <ArrowRight size={12} />
          </Link>
        </div>
      </div>

      {/*
        The two line-item tables Filevine shows beneath the summary. The
        reduction is entered here, per line, because it is a negotiation
        outcome rather than a property of the bill.
      */}
      <LineTable
        title="Medical Bills"
        lines={result.medicals?.lines || []}
        total={result.medicalCents}
        original={result.medicalOriginalCents}
        onReduction={setReduction}
        emptyHref={`/matters/${matterId}/medicals`}
        emptyLabel="No provider rows on Medicals yet."
      />

      <LineTable
        title="Expenses"
        lines={result.expenseLines?.lines || []}
        total={result.expenseCents}
        original={result.expenseOriginalCents}
        onReduction={setReduction}
        emptyHref={`/matters/${matterId}/expenses`}
        emptyLabel="No expense rows yet."
      />

      <p className="text-xs text-warn-ink">
        A working figure, not a disbursement statement. Confirm the fee basis against the fee
        agreement and every lien balance in writing before anything is paid out.
      </p>
    </div>
  );
}

/**
 * One of the two deduction tables Filevine shows beneath the summary:
 * provider, original amount, reduction %, reduced amount.
 *
 * The percentage is edited here rather than on the Meds or Expenses row,
 * because negotiating a bill down is an outcome of this calculation and must
 * not rewrite the record of what was originally charged.
 */
function LineTable({ title, lines, total, original, onReduction, emptyHref, emptyLabel }) {
  return (
    <div className="bg-surface rounded-xl border border-line shadow-sm">
      <div className="px-5 py-3 border-b border-line-soft flex items-center justify-between">
        <h2 className="font-semibold text-ink">{title}</h2>
        <span className="text-sm tabular-nums text-ink-2">
          {original !== total ? (
            <span className="text-ink-4 line-through mr-2">{formatMoney(original)}</span>
          ) : null}
          {formatMoney(total)}
        </span>
      </div>

      {lines.length === 0 ? (
        <p className="px-5 py-6 text-center text-sm text-ink-4">
          {emptyLabel}{' '}
          <Link href={emptyHref} className="text-accent-ink hover:underline">Add one</Link>
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line-soft bg-canvas">
              {['Provider', 'Original Amount', 'Red. (%)', 'Reduced Amount'].map((h, i) => (
                <th
                  key={h}
                  className={`px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-4 ${i ? 'text-right' : 'text-left'}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b border-line-soft last:border-0">
                <td className="px-4 py-2 text-ink">{l.label}</td>
                <td className="px-4 py-2 text-right tabular-nums text-ink-2">
                  {formatMoney(l.originalCents)}
                </td>
                <td className="px-4 py-2 text-right">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={l.percent || 0}
                    onChange={(e) => onReduction(l.id, e.target.value)}
                    className="input w-20 text-right"
                  />
                </td>
                <td className="px-4 py-2 text-right tabular-nums font-medium text-ink">
                  {formatMoney(l.reducedCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
