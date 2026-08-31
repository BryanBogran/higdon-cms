'use client';

/**
 * Import cases from a spreadsheet.
 *
 * The firm is rebuilding its case list from court records, Drive folder names,
 * calendars and the paralegals' own spreadsheets, so this screen is used
 * REPEATEDLY as more is recovered -- not once. Everything about it follows
 * from that:
 *
 *   Four steps, and the third is the point. Choose a file, check the columns,
 *   READ THE PLAN, then commit. Nothing is written until the plan has been on
 *   screen. The plan itself is computed by lib/domain/import.js, which is pure
 *   and tested; this file renders it and collects corrections.
 *
 *   Re-importing is safe and expected. A row whose case number is already on
 *   file updates that case instead of creating a second one, and an update
 *   only touches columns the file actually contains.
 *
 *   Ambiguous dates BLOCK. If a column could be read as either month-first or
 *   day-first, the import will not proceed until someone says which. There is
 *   no default, because the default is wrong half the time and a wrong SOL is
 *   the failure this whole system exists to prevent.
 */

import { useState, useMemo, useRef } from 'react';
import Link from 'next/link';
import Papa from 'papaparse';
import { readXlsx } from '@/lib/domain/xlsx';
import {
  Upload, FileSpreadsheet, AlertTriangle, ArrowLeft, ArrowRight,
  CheckCircle2, Loader2, Plus, RefreshCw, SkipForward,
} from 'lucide-react';
import { useData } from '@/lib/data/DataProvider';
import { FIELDS, FIELD_BY_KEY } from '@/lib/domain/fields';
import {
  mapHeaders, dateConventions, planImport, unresolvedDateColumns, spreadsheetRow,
} from '@/lib/domain/import';

const STEPS = ['File', 'Columns', 'Review', 'Done'];

/* Grouped for the column picker, so a 30-entry list is navigable. */
const FIELD_GROUPS = [...new Set(FIELDS.map((f) => f.section))].map((section) => ({
  section,
  fields: FIELDS.filter((f) => f.section === section),
}));

const CONVENTION_LABEL = {
  ISO: 'YYYY-MM-DD',
  MDY: 'Month first (US)',
  DMY: 'Day first',
  ambiguous: 'Could be either',
  conflict: 'Mixed formats',
  empty: 'No dates found',
};

export default function ImportPage() {
  const { matters, importMatters, loaded } = useData();

  const [step, setStep] = useState(0);
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [overrides, setOverrides] = useState({});
  const [resolved, setResolved] = useState({});
  const [parseError, setParseError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [filter, setFilter] = useState('all');
  const inputRef = useRef(null);

  const columns = useMemo(() => mapHeaders(headers, overrides), [headers, overrides]);
  const conventions = useMemo(() => dateConventions(columns, rows), [columns, rows]);
  const blockers = useMemo(
    () => unresolvedDateColumns(conventions, resolved),
    [conventions, resolved]
  );
  const plan = useMemo(
    () => planImport({ rows, columns, matters, conventions, resolvedConventions: resolved }),
    [rows, columns, matters, conventions, resolved]
  );

  /**
   * Rows out of a file, whatever kind it is.
   *
   * ── Why .xlsx is read directly rather than asked for as CSV ────────────
   *
   * Every report Filevine produced for this firm is .xlsx, and telling
   * someone to re-save 24 files as CSV is not just tedious — it is where
   * dates break. Excel writes a date out using the machine's locale, so a
   * Statute of Limitations of 3 August becomes "8/3/26" on one laptop and
   * "3/8/26" on another, and this importer then has to infer which. It
   * infers well; on a column where no day exceeds 12 it cannot infer at all
   * and blocks, which is correct and also a dead end.
   *
   * Inside the .xlsx that cell is the number 46251 with a date format on it.
   * Read directly, the ambiguity never exists. On the SOL column that is the
   * difference between a deadline and a malpractice claim.
   */
  async function readWorkbook(file) {
    const rowsOut = await readXlsx(await file.arrayBuffer());
    const nonEmpty = rowsOut.filter((r) => r.some((c) => String(c ?? '').trim()));
    if (!nonEmpty.length) throw new Error('That spreadsheet has no rows in it.');
    return nonEmpty;
  }

  function accept(file, data, errors) {
    if (!data.length) {
      setParseError('That file has no rows in it.');
      return;
    }
    // A CSV exported from Excel can carry a byte-order mark on the first
    // header, which would stop "Client Name" matching anything at all.
    const head = (data[0] || []).map((h, i) =>
      i === 0 ? String(h ?? '').replace(/^\ufeff/, '') : String(h ?? '')
    );
    const body = data.slice(1).filter((r) => r.some((c) => String(c ?? '').trim()));
    if (!body.length) {
      setParseError('That file has headers but no data rows.');
      return;
    }
    setFileName(file.name);
    setHeaders(head);
    setRows(body);
    setOverrides({});
    setResolved({});
    setResult(null);
    setStep(1);
    if (errors?.length) {
      setParseError(`${errors.length} row(s) looked malformed and were read as best we could.`);
    }
  }

  function readFile(file) {
    if (!file) return;
    setParseError('');

    // Decided by content where possible, not by the extension: a .xls that is
    // really a modern workbook, or an .xlsx renamed to .csv, both happen.
    if (/\.xlsx?$/i.test(file.name)) {
      readWorkbook(file)
        .then((data) => accept(file, data, null))
        .catch((err) => setParseError(err?.message || 'Could not read that spreadsheet.'));
      return;
    }

    Papa.parse(file, {
      skipEmptyLines: 'greedy',
      complete: ({ data, errors }) => {
        if (!data.length) {
          setParseError('That file has no rows in it.');
          return;
        }
        accept(file, data, errors);
      },
      error: (err) => setParseError(err?.message || 'Could not read that file.'),
    });
  }

  async function commit() {
    setBusy(true);
    const toWrite = plan.entries.filter((e) => e.action !== 'skip');
    const r = await importMatters(toWrite);
    setResult(r);
    setBusy(false);
    setStep(3);
  }

  const mappedCount = columns.filter((c) => c.key).length;
  const visible = plan.entries.filter((e) => {
    if (filter === 'all') return true;
    if (filter === 'warnings') return e.warnings.length > 0;
    return e.action === filter;
  });

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="flex items-center gap-3 mb-1">
        <h1 className="text-2xl font-bold text-slate-900">Import cases</h1>
        <Link href="/projects" className="text-sm text-slate-500 hover:text-slate-700">
          Project Hub
        </Link>
      </div>
      <p className="text-sm text-slate-500 mb-6">
        A spreadsheet of cases — .xlsx straight out of Filevine, or a CSV. Import the same file again later and it updates
        those cases rather than duplicating them.
      </p>

      {/* ---------- step rail ---------- */}
      <ol className="flex items-center gap-2 mb-8 text-xs">
        {STEPS.map((label, i) => (
          <li key={label} className="flex items-center gap-2">
            <span
              className={`px-2.5 py-1 rounded-full font-semibold ${
                i === step
                  ? 'bg-slate-900 text-white'
                  : i < step
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-slate-100 text-slate-400'
              }`}
            >
              {i + 1}. {label}
            </span>
            {i < STEPS.length - 1 ? <span className="text-slate-300">→</span> : null}
          </li>
        ))}
      </ol>

      {!loaded ? <p className="text-sm text-slate-500">Loading existing cases…</p> : null}

      {/* ---------- 1. file ---------- */}
      {step === 0 ? (
        <div>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              readFile(e.dataTransfer.files?.[0]);
            }}
            className="w-full border-2 border-dashed border-slate-300 rounded-xl py-16 grid place-items-center gap-3 hover:border-slate-400 hover:bg-slate-50 transition"
          >
            <Upload size={28} className="text-slate-400" />
            <span className="font-medium text-slate-700">Drop a spreadsheet here, or click to choose</span>
            <span className="text-xs text-slate-500">
              .xlsx or .csv. Filevine&apos;s exports are .xlsx — use them as they are, rather than
              re-saving as CSV, which is where dates get read the wrong way round.
            </span>
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => readFile(e.target.files?.[0])}
          />
          {parseError ? (
            <p className="mt-3 text-sm text-rose-700 flex items-center gap-1.5">
              <AlertTriangle size={14} /> {parseError}
            </p>
          ) : null}

          <div className="mt-8 rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="font-semibold text-slate-900 mb-2">What the file needs</h2>
            <p className="text-sm text-slate-600 mb-3">
              One row per case, with a header row on top. Only <strong>Client Name</strong> is
              required — a row without one is skipped, because a case nobody can look up by name
              is not findable at all.
            </p>
            <p className="text-sm text-slate-600">
              Include <strong>Case Number</strong> if you have it. It is what lets you import the
              same file again after you have recovered more, without ending up with two of
              everything.
            </p>
            <pre className="mt-3 text-xs bg-slate-50 border border-slate-200 rounded p-3 overflow-x-auto">
{`Client Name,Case Number,DOA,SOL,Trial Date,Status,Attorney
"Rivera, Marcus",26-001,2024-10-15,2026-10-15,,Open,PH`}
            </pre>
            <p className="mt-2 text-xs text-slate-500">
              Note the quotes around the name. A client name written{' '}
              <strong>Last, First</strong> contains a comma, which would otherwise split it across
              two columns. Excel and Google Sheets add those quotes for you when you save as CSV —
              this only bites if the file was typed by hand.
            </p>
          </div>
        </div>
      ) : null}

      {/* ---------- 2. columns ---------- */}
      {step === 1 ? (
        <div>
          <div className="flex items-center gap-2 text-sm text-slate-600 mb-4">
            <FileSpreadsheet size={16} className="text-slate-400" />
            <span className="font-medium text-slate-800">{fileName}</span>
            <span className="text-slate-400">·</span>
            <span>{rows.length} rows</span>
            <span className="text-slate-400">·</span>
            <span>{mappedCount} of {headers.length} columns mapped</span>
          </div>

          {parseError ? (
            <p className="mb-4 text-sm text-amber-700 flex items-center gap-1.5">
              <AlertTriangle size={14} /> {parseError}
            </p>
          ) : null}

          <div className="rounded-lg border border-slate-200 overflow-hidden bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left px-4 py-2.5 font-semibold text-slate-500 text-xs uppercase tracking-wide">Column in your file</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-slate-500 text-xs uppercase tracking-wide">First value</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-slate-500 text-xs uppercase tracking-wide">Imports as</th>
                </tr>
              </thead>
              <tbody>
                {columns.map((col) => {
                  const sample = rows.find((r) => String(r[col.index] ?? '').trim());
                  return (
                    <tr key={col.index} className="border-t border-slate-100">
                      <td className="px-4 py-2.5 font-medium text-slate-800">{col.header || <em className="text-slate-400">(no header)</em>}</td>
                      <td className="px-4 py-2.5 text-slate-500 truncate max-w-[14rem]">
                        {sample ? String(sample[col.index]).slice(0, 40) : '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        <select
                          className="input w-full max-w-xs"
                          value={col.key}
                          onChange={(e) =>
                            setOverrides((o) => ({ ...o, [col.index]: e.target.value }))
                          }
                        >
                          <option value="">Do not import</option>
                          {FIELD_GROUPS.map((g) => (
                            <optgroup key={g.section} label={g.section}>
                              {g.fields.map((f) => (
                                <option key={f.key} value={f.key}>{f.label}</option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Ambiguous date columns block the import. */}
          {blockers.length ? (
            <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-5">
              <h2 className="font-semibold text-amber-900 flex items-center gap-1.5 mb-1">
                <AlertTriangle size={16} /> Which way round are these dates?
              </h2>
              <p className="text-sm text-amber-900/80 mb-4">
                <strong>03/04/2026</strong> is the 4th of March in Houston and the 3rd of April in
                London, and nothing in the file settles it. Every other date column was worked out
                from the data — these could not be.
              </p>
              {blockers.map((b) => (
                <div key={b.key} className="flex items-center gap-3 mb-2">
                  <span className="text-sm font-medium text-amber-900 w-28">{b.label}</span>
                  <select
                    className="input max-w-xs"
                    value={resolved[b.key] || ''}
                    onChange={(e) => setResolved((r) => ({ ...r, [b.key]: e.target.value }))}
                  >
                    <option value="">Choose…</option>
                    <option value="MDY">Month first — 03/04 is March 4</option>
                    <option value="DMY">Day first — 03/04 is April 3</option>
                  </select>
                </div>
              ))}
            </div>
          ) : null}

          {/* Date columns settled from the data, shown so it is not magic. */}
          {Object.keys(conventions).length ? (
            <p className="mt-4 text-xs text-slate-500">
              Date formats read from your data:{' '}
              {Object.entries(conventions).map(([key, conv], i) => (
                <span key={key}>
                  {i ? ' · ' : ''}
                  <strong className="text-slate-700">{FIELD_BY_KEY[key]?.label || key}</strong>{' '}
                  {CONVENTION_LABEL[resolved[key] || conv] || conv}
                </span>
              ))}
            </p>
          ) : null}

          <div className="flex items-center gap-3 mt-6">
            <button type="button" className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1" onClick={() => setStep(0)}>
              <ArrowLeft size={14} /> Choose a different file
            </button>
            <span className="flex-1" />
            <button
              type="button"
              disabled={blockers.length > 0 || !columns.some((c) => c.key === 'clientName')}
              onClick={() => setStep(2)}
              className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              See what this will do <ArrowRight size={14} />
            </button>
          </div>
          {!columns.some((c) => c.key === 'clientName') ? (
            <p className="mt-2 text-sm text-rose-700 text-right">
              One column has to be Client Name.
            </p>
          ) : null}
        </div>
      ) : null}

      {/* ---------- 3. review ---------- */}
      {step === 2 ? (
        <div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <Stat label="New cases" value={plan.summary.create} tone="emerald" icon={Plus} />
            <Stat label="Updated" value={plan.summary.update} tone="sky" icon={RefreshCw} />
            <Stat label="Skipped" value={plan.summary.skip} tone="slate" icon={SkipForward} />
            <Stat label="Warnings" value={plan.summary.warnings} tone="amber" icon={AlertTriangle} />
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4 mb-6">
            <p className="text-sm text-slate-700">
              <strong>{plan.summary.withSol}</strong> of the {plan.summary.create + plan.summary.update}{' '}
              cases being written carry an SOL.
              {plan.summary.create + plan.summary.update - plan.summary.withSol > 0 ? (
                <>
                  {' '}The other{' '}
                  <strong>{plan.summary.create + plan.summary.update - plan.summary.withSol}</strong>{' '}
                  will appear under <em>Missing Key Dates</em> on the dashboard until one is entered.
                </>
              ) : null}
            </p>
          </div>

          <div className="flex items-center gap-2 mb-3 text-xs">
            {['all', 'create', 'update', 'skip', 'warnings'].map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`px-2.5 py-1 rounded-full font-medium capitalize ${
                  filter === f ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          <div className="rounded-lg border border-slate-200 overflow-hidden bg-white">
            <div className="overflow-x-auto max-h-[28rem] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold text-slate-500 text-xs uppercase">Row</th>
                    <th className="text-left px-3 py-2 font-semibold text-slate-500 text-xs uppercase">Client</th>
                    <th className="text-left px-3 py-2 font-semibold text-slate-500 text-xs uppercase">Case #</th>
                    <th className="text-left px-3 py-2 font-semibold text-slate-500 text-xs uppercase">SOL</th>
                    <th className="text-left px-3 py-2 font-semibold text-slate-500 text-xs uppercase">What happens</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((e) => (
                    <tr key={e.rowIndex} className="border-t border-slate-100 align-top">
                      <td className="px-3 py-2 text-slate-400 tabular-nums">{spreadsheetRow(e.rowIndex)}</td>
                      <td className="px-3 py-2 font-medium text-slate-800">{e.values.clientName || '—'}</td>
                      <td className="px-3 py-2 text-slate-600 tabular-nums">{e.values.caseNumber || '—'}</td>
                      <td className="px-3 py-2 text-slate-600 tabular-nums">{e.values.sol || '—'}</td>
                      <td className="px-3 py-2">
                        <ActionTag action={e.action} />
                        <span className="text-slate-500 ml-2">{e.reason}</span>
                        {e.warnings.map((w, i) => (
                          <div key={i} className="text-amber-700 text-xs mt-1 flex items-start gap-1">
                            <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {w}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                  {!visible.length ? (
                    <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-400">Nothing in this filter.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center gap-3 mt-6">
            <button type="button" className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1" onClick={() => setStep(1)}>
              <ArrowLeft size={14} /> Back to columns
            </button>
            <span className="flex-1" />
            <button
              type="button"
              disabled={busy || plan.summary.create + plan.summary.update === 0}
              onClick={commit}
              className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium disabled:opacity-40 flex items-center gap-1.5"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : null}
              Import {plan.summary.create + plan.summary.update} cases
            </button>
          </div>
        </div>
      ) : null}

      {/* ---------- 4. done ---------- */}
      {step === 3 && result ? (
        <div>
          <div
            className={`rounded-lg border p-5 ${
              result.ok ? 'border-emerald-200 bg-emerald-50' : 'border-amber-300 bg-amber-50'
            }`}
          >
            <h2 className="font-semibold text-slate-900 flex items-center gap-2 mb-1">
              {result.ok ? <CheckCircle2 size={18} className="text-emerald-600" /> : <AlertTriangle size={18} className="text-amber-600" />}
              {result.ok ? 'Import finished' : 'Imported, with problems'}
            </h2>
            <p className="text-sm text-slate-700">
              <strong>{result.created ?? 0}</strong> created, <strong>{result.updated ?? 0}</strong> updated.
              {result.error ? <> {result.error}</> : null}
            </p>
            {result.failed?.length ? (
              <ul className="mt-3 text-sm text-amber-900 list-disc pl-5">
                {result.failed.slice(0, 20).map((f, i) => (
                  <li key={i}>
                    {f.rowIndex === null ? '' : `Row ${spreadsheetRow(f.rowIndex)}: `}{f.error}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {/*
            Imported cases have no Drive folder attached yet. The matching
            already exists on the Drive sync page and only links a folder when
            exactly one case matches and nothing else is close -- but nothing
            told anyone to go and run it, so 200 freshly imported cases would
            sit there looking document-less.
          */}
          {(result.created ?? 0) > 0 ? (
            <div className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
              <h3 className="font-semibold text-slate-900 mb-2">Attach the documents</h3>
              <p className="text-sm text-slate-600 mb-3">
                These cases have no Drive folder linked yet. Drive sync matches your existing
                folders to them by name — it links a folder only when exactly one case matches and
                nothing else is close, and queues anything doubtful for you to decide.
              </p>
              <Link
                href="/documents/drive"
                className="inline-block px-3 py-1.5 rounded-lg border border-slate-300 text-sm font-medium text-slate-700"
              >
                Run Drive sync
              </Link>
            </div>
          ) : null}

          <div className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
            <h3 className="font-semibold text-slate-900 mb-2">Check this now, before you rely on it</h3>
            <p className="text-sm text-slate-600 mb-3">
              Open the dashboard and read <em>Missing Key Dates</em>. Every case listed there has no
              SOL and no trial date. Each one should be a case you have decided is fine — not one
              whose date simply did not come across.
            </p>
            <div className="flex gap-3">
              <Link href="/" className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-sm font-medium">
                Open the dashboard
              </Link>
              <Link href="/projects" className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm font-medium text-slate-700">
                See all cases
              </Link>
              <button
                type="button"
                onClick={() => { setStep(0); setRows([]); setHeaders([]); setFileName(''); setResult(null); }}
                className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm font-medium text-slate-700"
              >
                Import another file
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value, tone, icon: Icon }) {
  const tones = {
    emerald: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    sky: 'text-sky-700 bg-sky-50 border-sky-200',
    slate: 'text-slate-600 bg-slate-50 border-slate-200',
    amber: 'text-amber-700 bg-amber-50 border-amber-200',
  };
  return (
    <div className={`rounded-lg border p-3 ${tones[tone]}`}>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide">
        <Icon size={12} /> {label}
      </div>
      <div className="text-2xl font-bold tabular-nums mt-0.5">{value}</div>
    </div>
  );
}

function ActionTag({ action }) {
  const map = {
    create: ['New', 'bg-emerald-100 text-emerald-800'],
    update: ['Update', 'bg-sky-100 text-sky-800'],
    skip: ['Skip', 'bg-slate-200 text-slate-600'],
  };
  const [label, cls] = map[action] || ['?', 'bg-slate-100'];
  return <span className={`px-1.5 py-0.5 rounded text-[11px] font-semibold ${cls}`}>{label}</span>;
}
