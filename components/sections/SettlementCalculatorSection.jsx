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
  const expenseRows = sectionState(matterId, 'expenses').rows;
  const lienRows = sectionState(matterId, 'liens').rows;

  const feePercent = Number(settings.feePercent ?? 33.333);
  const feeBasis = settings.feeBasis || FEE_BASIS.GROSS;
  const expenseBasis = settings.expenseBasis || EXPENSE_BASIS.INVOICED;

  const result = useMemo(
    () =>
      computeSettlement({
        gross: matter?.values?.settlementAmount,
        feePercent,
        feeBasis,
        expenseRows,
        expenseBasis,
        lienRows,
      }),
    [matter?.values?.settlementAmount, feePercent, feeBasis, expenseRows, expenseBasis, lienRows]
  );

  const lines = statementLines(result);

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="px-5 py-3 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900">Inputs</h2>
        </div>
        <div className="p-5 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
              Gross Settlement
            </label>
            <input
              className="input"
              placeholder="$0.00"
              value={matter?.values?.settlementAmount || ''}
              onChange={(e) => updateMatterField(matterId, 'settlementAmount', e.target.value)}
            />
            <p className="mt-1 text-xs text-slate-500">
              The matter&apos;s Settlement Amount. Editing it here edits it everywhere.
            </p>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
              Attorney Fee %
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
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
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
            <p className="mt-1 text-xs text-slate-500">Check the fee agreement — the two differ.</p>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
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
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
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
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-1.5">
          {result.warnings.map((w, i) => (
            <p key={i} className="flex items-start gap-1.5 text-sm text-amber-800">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {w}
            </p>
          ))}
        </div>
      ) : null}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="px-5 py-3 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900">Disbursement</h2>
        </div>

        {!result.ok ? (
          <p className="px-5 py-10 text-center text-sm text-slate-400">
            Enter a gross settlement amount above.
          </p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {lines.map((l, i) => (
                <tr
                  key={i}
                  className={`border-b border-slate-100 last:border-0 ${
                    l.kind === 'net' ? 'bg-slate-50 font-semibold' : ''
                  }`}
                >
                  <td className="px-5 py-2.5 text-slate-700">{l.label}</td>
                  <td
                    className={`px-5 py-2.5 text-right tabular-nums ${
                      l.kind === 'net'
                        ? l.cents < 0 ? 'text-red-700' : 'text-slate-900'
                        : l.kind === 'deduction' ? 'text-slate-600' : 'text-slate-900'
                    }`}
                  >
                    {formatMoney(l.cents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="px-5 py-3 border-t border-slate-100 flex flex-wrap gap-4 text-xs text-slate-500">
          <Link href={`/matters/${matterId}/expenses`} className="flex items-center gap-1 text-teal-700 hover:underline">
            {result.counts?.expenses ?? 0} expense row{(result.counts?.expenses ?? 0) === 1 ? '' : 's'} <ArrowRight size={12} />
          </Link>
          <Link href={`/matters/${matterId}/liens`} className="flex items-center gap-1 text-teal-700 hover:underline">
            {result.counts?.liens ?? 0} lien{(result.counts?.liens ?? 0) === 1 ? '' : 's'} <ArrowRight size={12} />
          </Link>
          {result.lienReducedCents ? (
            <span>Lien reductions negotiated: {formatMoney(result.lienReducedCents)}</span>
          ) : null}
        </div>
      </div>

      <p className="text-xs text-amber-700">
        A working figure, not a disbursement statement. Confirm the fee basis against the fee
        agreement and every lien balance in writing before anything is paid out.
      </p>
    </div>
  );
}
