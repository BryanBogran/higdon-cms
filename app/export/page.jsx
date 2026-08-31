'use client';

/**
 * Take the data out.
 *
 * Built the week the firm lost access to its previous system with no export.
 * The lesson was not about that vendor: any system of record that cannot hand
 * back its records is one you are trapped in, and you find out on the worst
 * possible day. So this exists before the firm depends on the app, not after.
 *
 * Everything is produced in the browser from data already loaded, so there is
 * no new endpoint, no service-role key, and nothing to secure. It runs as the
 * signed-in user and can therefore only export what that user can already see.
 */

import { useState } from 'react';
import { Download, FileSpreadsheet, Database, AlertTriangle } from 'lucide-react';
import { useData } from '@/lib/data/DataProvider';
import { caseListCsv, buildBackup, backupFilename } from '@/lib/domain/export';

function download(filename, text, mimeType) {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on a later tick: revoking synchronously can cancel the download
  // in some browsers before it has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export default function ExportPage() {
  const { matters, tasks, activity, sections, relations, team, loaded, backend } = useData();
  const [last, setLast] = useState('');

  const counts = {
    matters: Object.keys(matters || {}).length,
    tasks: Object.keys(tasks || {}).length,
    activity: Object.keys(activity || {}).length,
    relations: (relations || []).length,
  };

  function saveBackup() {
    const exportedAt = new Date().toISOString();
    const backup = buildBackup({ matters, tasks, activity, sections, relations, team, exportedAt });
    download(backupFilename(exportedAt), JSON.stringify(backup, null, 2), 'application/json');
    setLast(`Full backup saved — ${counts.matters} cases.`);
  }

  function saveCaseList() {
    const exportedAt = new Date().toISOString();
    download(backupFilename(exportedAt, 'csv'), caseListCsv(matters), 'text/csv;charset=utf-8');
    setLast(`Case list saved — ${counts.matters} cases.`);
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <h1 className="text-2xl font-bold text-slate-900">Export the firm's data</h1>
      <p className="mt-1 text-sm text-slate-500">
        Nothing here leaves your computer. Both files are built in the browser from data
        already on screen.
      </p>

      {!loaded ? <p className="mt-6 text-sm text-slate-500">Loading…</p> : (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <button
              type="button"
              onClick={saveCaseList}
              className="text-left rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-300 transition"
            >
              <div className="flex items-center gap-2 text-slate-900 font-semibold">
                <FileSpreadsheet size={16} className="text-teal-600" /> Case list (CSV)
              </div>
              <p className="mt-2 text-sm text-slate-600">
                One row per case, with every key date. Opens in Excel, and this app can read
                it back — so it is a restore, not just a printout.
              </p>
              <span className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-teal-700">
                <Download size={12} /> {counts.matters} cases
              </span>
            </button>

            <button
              type="button"
              onClick={saveBackup}
              className="text-left rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-300 transition"
            >
              <div className="flex items-center gap-2 text-slate-900 font-semibold">
                <Database size={16} className="text-teal-600" /> Full backup (JSON)
              </div>
              <p className="mt-2 text-sm text-slate-600">
                Everything the CSV flattens away — checklists, medical and expense rows,
                notes, tasks and related cases. Keep this one.
              </p>
              <span className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-teal-700">
                <Download size={12} /> {counts.matters} cases · {counts.activity} notes · {counts.tasks} tasks
              </span>
            </button>
          </div>

          {last ? <p className="mt-4 text-sm text-emerald-700">{last}</p> : null}

          <div className="mt-8 rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="font-semibold text-slate-900 mb-2">What this does not cover</h2>
            <ul className="text-sm text-slate-600 space-y-2 list-disc pl-5">
              <li>
                <strong>Documents.</strong> They live in your Google Drive and always have —
                this app only links to them. Losing this app does not touch a single file.
              </li>
              <li>
                <strong>Point-in-time recovery.</strong> An export is a snapshot of the moment
                you clicked. Turn on PITR in the Supabase dashboard so a mistake made on a
                Tuesday can be undone on a Tuesday.
              </li>
              <li>
                <strong>Automation.</strong> This is a button, so it runs when someone presses
                it. Put a weekly reminder in the calendar until it is scheduled.
              </li>
            </ul>
          </div>

          {backend === 'local' ? (
            <p className="mt-4 flex items-start gap-1.5 text-sm text-amber-700">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              Running on browser storage, so this exports only what is on this device.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
