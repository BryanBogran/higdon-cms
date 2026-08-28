'use client';

/**
 * Create a Project — Filevine's form, field for field.
 *
 *   Project Type*  ·  Add Client*  ·  Project Name  ·  Add a Team  ·  Create
 *
 * Two of those fields are honest about not doing much yet, and say so on the
 * screen rather than pretending:
 *
 *   PROJECT TYPE decides which sections a project gets. We have exactly one
 *   template, so the control is real but has one option. Shown anyway, because
 *   it is where a second practice area will attach, and because a form that
 *   changes shape later is harder to learn than one that does not.
 *
 *   ADD A TEAM has nowhere to go: there is no team model, and per-matter access
 *   control does not exist -- every signed-in user sees every matter. Putting a
 *   box here that silently discarded what you typed would be worse than the
 *   note that replaces it.
 *
 * Client name is required because `matter.client_name` is NOT NULL, and because
 * a matter with no client cannot be found again by the only name anyone knows.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { UserPlus, Loader2, AlertCircle } from 'lucide-react';
import { useData } from '@/lib/data/DataProvider';
import { todayInFirmTz } from '@/lib/domain/dates';

/** One entry per section set in lib/sections/registry.js. */
const PROJECT_TYPES = [{ key: 'pi-master', label: 'Personal Injury (Master)' }];

export default function NewProjectPage() {
  const router = useRouter();
  const { createMatter, team } = useData();

  const [projectType, setProjectType] = useState(PROJECT_TYPES[0].key);
  const [clientName, setClientName] = useState('');
  const [projectName, setProjectName] = useState('');
  const [attorney, setAttorney] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const attorneys = Object.values(team || {})
    .map((m) => m?.displayName || m?.name)
    .filter(Boolean)
    .sort();

  async function submit(e) {
    e.preventDefault();
    const name = clientName.trim();
    if (!name) {
      setError('A client name is required.');
      return;
    }

    setBusy(true);
    setError('');

    // createMatter is async -- it allocates the case number server-side -- so
    // the id must be awaited before navigating. Destructuring it synchronously
    // is how this broke once before; see docs/DECISIONS.md.
    const result = await createMatter({
      clientName: name,
      projectName: projectName.trim(),
      attorney: attorney.trim(),
      status: 'Open',
      openDate: todayInFirmTz(),
    });

    if (!result?.ok || !result.id) {
      setBusy(false);
      setError(result?.error || 'Could not create the project.');
      return;
    }

    /*
     * Give it a Drive folder, adopting one if intake already made it.
     *
     * Awaited so the folder exists before the Docs tab is first opened, but
     * NEVER allowed to fail the creation: the matter is the real action and
     * the folder is a convenience. The route returns 200 with a reason rather
     * than an error status for exactly this — a firm that cannot open a file
     * because Drive is down is a worse outcome than a missing folder.
     */
    try {
      await fetch('/api/drive/provision', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ matterId: result.id }),
      });
    } catch {
      // Offline, or Drive unreachable. The Docs tab offers a button.
    }

    setBusy(false);
    router.push(`/matters/${result.id}`);
  }

  return (
    <div>
      <div className="border-b border-slate-200 bg-white">
        <h1 className="px-6 py-5 text-2xl font-bold text-slate-900">Create a Project</h1>
      </div>

      <form onSubmit={submit} className="max-w-xl mx-auto px-6 py-10 space-y-6">
        <div>
          <label htmlFor="project-type" className="block text-sm font-semibold text-slate-800 mb-1.5">
            Project Type<span className="text-red-600">*</span>
          </label>
          <select
            id="project-type"
            value={projectType}
            onChange={(e) => setProjectType(e.target.value)}
            className="input"
          >
            {PROJECT_TYPES.map((t) => (
              <option key={t.key} value={t.key}>{t.label}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            One template so far. A second practice area would add its own section set.
          </p>
        </div>

        <div>
          <label htmlFor="client-name" className="block text-sm font-semibold text-slate-800 mb-1.5">
            Add Client<span className="text-red-600">*</span>
          </label>
          <div className="flex gap-2">
            <input
              id="client-name"
              autoFocus
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Last, First"
              className="input flex-1"
            />
            <span
              title="Filevine picks an existing contact card here. There is no Contacts model yet, so the name is typed."
              className="grid place-items-center w-11 rounded border border-slate-200 bg-slate-50 text-slate-300"
            >
              <UserPlus size={17} />
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Typed, not picked from Contacts — that model does not exist yet.
          </p>
        </div>

        <div>
          <label htmlFor="project-name" className="block text-sm font-semibold text-slate-800 mb-1.5">
            Project Name
          </label>
          <input
            id="project-name"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="Defaults to the client name and case number"
            className="input"
          />
        </div>

        <div>
          <label htmlFor="attorney" className="block text-sm font-semibold text-slate-800 mb-1.5">
            Attorney
          </label>
          <input
            id="attorney"
            list="attorney-list"
            value={attorney}
            onChange={(e) => setAttorney(e.target.value)}
            placeholder="Who is responsible for this file"
            className="input"
          />
          <datalist id="attorney-list">
            {attorneys.map((a) => <option key={a} value={a} />)}
          </datalist>
        </div>

        {/*
          Filevine's "Add a Team" box would go here. Left out rather than
          faked: there is no team model, and every signed-in user already sees
          every matter, so a team selection would change nothing at all.
        */}
        <div className="rounded border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-sm font-semibold text-slate-700">Add a Team</p>
          <p className="mt-1 text-xs text-slate-500">
            Not built. Everyone signed in sees every matter, which matches how the firm works
            today — a team picker would not restrict anything, so it would be a control that
            looks like it does something.
          </p>
        </div>

        {error ? (
          <p className="flex items-start gap-1.5 text-sm text-red-700">
            <AlertCircle size={15} className="mt-0.5 shrink-0" /> {error}
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-3 pt-2">
          <Link href="/projects" className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900">
            Cancel
          </Link>
          <button
            type="submit"
            disabled={busy || !clientName.trim()}
            className="flex items-center gap-2 px-6 py-2 rounded bg-teal-600 text-white text-sm font-semibold hover:bg-teal-500 disabled:opacity-40"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : null}
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}
