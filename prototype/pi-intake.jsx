import React, { useState, useEffect, useMemo } from "react";
import { AlertTriangle, Calendar, CheckCircle2, ChevronDown, Search, X, Clock, Building2, User, ShieldAlert, FileText } from "lucide-react";

// ---------- SOL rule engine (Texas — plain date math, never AI-guessed) ----------
const CASE_TYPES = [
  {
    id: "auto",
    label: "Motor Vehicle Collision",
    rule: "General negligence — Tex. Civ. Prac. & Rem. Code §16.003",
    years: 2,
    anchor: "doa",
    flag: null,
  },
  {
    id: "premises",
    label: "Premises Liability",
    rule: "General negligence — Tex. Civ. Prac. & Rem. Code §16.003",
    years: 2,
    anchor: "doa",
    flag: null,
  },
  {
    id: "product",
    label: "Product Liability",
    rule: "Tex. Civ. Prac. & Rem. Code §16.003 (also subject to 15-yr statute of repose §16.012)",
    years: 2,
    anchor: "doa",
    flag: "Check the 15-year statute of repose separately — it can bar the claim even inside the 2-year SOL.",
  },
  {
    id: "medmal",
    label: "Medical Malpractice",
    rule: "Tex. Civ. Prac. & Rem. Code §74.251(a)",
    years: 2,
    anchor: "doa",
    flag: "Chapter 74 applies — expert report deadline, notice letter (60 days pre-suit), and minor-patient exceptions under §74.251(b) need separate attorney review.",
  },
  {
    id: "wrongfuldeath",
    label: "Wrongful Death",
    rule: "Tex. Civ. Prac. & Rem. Code §16.003(b) — runs from date of death, not date of injury",
    years: 2,
    anchor: "death",
    flag: null,
  },
  {
    id: "govt",
    label: "Claim vs. Governmental Entity",
    rule: "Texas Tort Claims Act — Tex. Civ. Prac. & Rem. Code §101.101",
    years: 2,
    anchor: "doa",
    flag: "URGENT: written notice is due within 6 months of the incident (often as little as 90 days under a city's own charter — e.g. Houston). This notice deadline is usually the real trap, not the 2-yr SOL.",
  },
  {
    id: "other",
    label: "Other / General Negligence",
    rule: "Tex. Civ. Prac. & Rem. Code §16.003",
    years: 2,
    anchor: "doa",
    flag: null,
  },
];

const INSURANCE_TYPES = [
  { id: "commercial", label: "Commercial", hint: "trucking, business auto, CGL, commercial umbrella" },
  { id: "personal", label: "Personal Lines", hint: "personal auto, homeowners/renters" },
  { id: "govt", label: "Self-Insured / Government", hint: "municipal, county, state entity" },
  { id: "unknown", label: "Unknown / Uninsured", hint: "not yet identified" },
];

function addYears(dateStr, years) {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00");
  d.setFullYear(d.getFullYear() + years);
  return d;
}

function subtractDays(date, days) {
  if (!date) return null;
  const d = new Date(date);
  d.setDate(d.getDate() - days);
  return d;
}

function fmt(date) {
  if (!date) return "—";
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function isoDate(date) {
  if (!date) return "";
  return date.toISOString().slice(0, 10);
}

function daysUntil(date) {
  if (!date) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  return Math.round((target - now) / 86400000);
}

const REMINDER_OFFSETS = [120, 90, 60, 30, 0];

const emptyForm = {
  clientName: "",
  caseNumber: "",
  attorney: "",
  referral: "",
  doa: "",
  caseType: "auto",
  jurisdiction: "",
  defendant: "",
  insuranceType: "personal",
  carrier: "",
  policyLimits: "",
  isMinor: false,
  minorDob: "",
  solOverride: "",
  notes: "",
};

export default function PIIntake() {
  const [form, setForm] = useState(emptyForm);
  const [intakes, setIntakes] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [reminderModal, setReminderModal] = useState(null);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get("pi-intakes", false);
        if (res && res.value) setIntakes(JSON.parse(res.value));
      } catch (e) {
        // no data yet
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    window.storage.set("pi-intakes", JSON.stringify(intakes), false).catch(() => {});
  }, [intakes, loaded]);

  const caseType = CASE_TYPES.find((c) => c.id === form.caseType);

  const solDate = useMemo(() => {
    if (form.solOverride) return new Date(form.solOverride + "T00:00:00");
    if (!form.doa) return null;
    return addYears(form.doa, caseType.years);
  }, [form.doa, form.solOverride, caseType]);

  const reminders = useMemo(() => {
    if (!solDate) return [];
    return REMINDER_OFFSETS.map((offset) => ({
      offset,
      date: subtractDays(solDate, offset),
      label: offset === 0 ? "SOL Expires" : `${offset}-day SOL warning`,
    }));
  }, [solDate]);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function resetForm() {
    setForm(emptyForm);
  }

  function saveIntake() {
    if (!form.clientName || !form.doa) return;
    const record = {
      id: crypto.randomUUID(),
      ...form,
      solDate: solDate ? isoDate(solDate) : "",
      createdAt: new Date().toISOString(),
    };
    setIntakes((prev) => [record, ...prev]);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2000);
    resetForm();
  }

  function deleteIntake(id) {
    setIntakes((prev) => prev.filter((i) => i.id !== id));
  }

  const filtered = intakes.filter((i) => {
    if (filter !== "all" && i.insuranceType !== filter) return false;
    if (search) {
      const s = search.toLowerCase();
      return (
        i.clientName.toLowerCase().includes(s) ||
        i.caseNumber.toLowerCase().includes(s) ||
        i.defendant.toLowerCase().includes(s)
      );
    }
    return true;
  });

  const solDays = daysUntil(solDate);
  const urgency =
    solDays === null ? "none" : solDays < 30 ? "critical" : solDays < 90 ? "warning" : "ok";

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900" style={{ fontFamily: "'IBM Plex Sans', 'Inter', system-ui, sans-serif" }}>
      {/* Header */}
      <div className="bg-slate-900 text-white">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-widest text-slate-400 font-semibold">Higdon Lawyers</div>
            <h1 className="text-xl font-bold mt-0.5">PI Plaintiff Intake</h1>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-300 bg-slate-800 rounded-full px-3 py-1.5">
            <Calendar size={14} />
            Syncs to Higdon Lawyers Google Calendar
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-5 gap-8">
        {/* Form */}
        <div className="lg:col-span-3 bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-2">
            <User size={18} className="text-slate-500" />
            <h2 className="font-semibold text-slate-800">New Intake</h2>
          </div>

          <div className="p-6 space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Client Name" required>
                <input
                  value={form.clientName}
                  onChange={(e) => update("clientName", e.target.value)}
                  placeholder="Last, First"
                  className="input"
                />
              </Field>
              <Field label="Case Number">
                <input
                  value={form.caseNumber}
                  onChange={(e) => update("caseNumber", e.target.value)}
                  placeholder="e.g. 26-014"
                  className="input"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Attorney">
                <input value={form.attorney} onChange={(e) => update("attorney", e.target.value)} className="input" />
              </Field>
              <Field label="Referral Source">
                <input value={form.referral} onChange={(e) => update("referral", e.target.value)} className="input" />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Date of Accident" required>
                <input
                  type="date"
                  value={form.doa}
                  onChange={(e) => update("doa", e.target.value)}
                  className="input"
                />
              </Field>
              <Field label="Case Type" required>
                <select value={form.caseType} onChange={(e) => update("caseType", e.target.value)} className="input">
                  {CASE_TYPES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Jurisdiction / County">
                <input value={form.jurisdiction} onChange={(e) => update("jurisdiction", e.target.value)} className="input" />
              </Field>
              <Field label="Defendant / At-Fault Party">
                <input value={form.defendant} onChange={(e) => update("defendant", e.target.value)} className="input" />
              </Field>
            </div>

            {/* Insurance classification — drives the Commercial vs Personal Lines filter */}
            <div>
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                Insurance Classification <span className="text-red-500">*</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {INSURANCE_TYPES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => update("insuranceType", t.id)}
                    className={`text-left rounded-lg border px-3 py-2 transition ${
                      form.insuranceType === t.id
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-200 hover:border-slate-400"
                    }`}
                  >
                    <div className="text-sm font-medium flex items-center gap-1.5">
                      {t.id === "commercial" ? <Building2 size={13} /> : <ShieldAlert size={13} />}
                      {t.label}
                    </div>
                    <div className={`text-[11px] mt-0.5 ${form.insuranceType === t.id ? "text-slate-300" : "text-slate-400"}`}>
                      {t.hint}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Insurance Carrier">
                <input value={form.carrier} onChange={(e) => update("carrier", e.target.value)} className="input" />
              </Field>
              <Field label="Policy Limits">
                <input value={form.policyLimits} onChange={(e) => update("policyLimits", e.target.value)} className="input" placeholder="$ / unknown" />
              </Field>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="minor"
                checked={form.isMinor}
                onChange={(e) => update("isMinor", e.target.checked)}
                className="w-4 h-4"
              />
              <label htmlFor="minor" className="text-sm text-slate-700">Plaintiff is a minor (SOL tolling may apply — confirm with attorney)</label>
            </div>

            <Field label="Notes">
              <textarea
                value={form.notes}
                onChange={(e) => update("notes", e.target.value)}
                rows={3}
                className="input resize-none"
              />
            </Field>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={saveIntake}
                disabled={!form.clientName || !form.doa}
                className="bg-slate-900 text-white px-5 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-800 transition"
              >
                Save Intake
              </button>
              <button onClick={resetForm} className="text-sm text-slate-500 hover:text-slate-800">
                Clear
              </button>
              {savedFlash && (
                <span className="text-sm text-emerald-600 font-medium flex items-center gap-1">
                  <CheckCircle2 size={15} /> Saved
                </span>
              )}
            </div>
          </div>
        </div>

        {/* SOL panel */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <div className="flex items-center gap-2 mb-4">
              <Clock size={18} className="text-slate-500" />
              <h2 className="font-semibold text-slate-800">Statute of Limitations</h2>
            </div>

            {!form.doa ? (
              <p className="text-sm text-slate-400">Enter a date of accident to calculate the SOL.</p>
            ) : (
              <>
                <div className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold mb-1">Rule applied</div>
                <div className="text-sm text-slate-700 mb-4">{caseType.rule}</div>

                <div
                  className={`rounded-lg p-4 mb-3 border ${
                    urgency === "critical"
                      ? "bg-red-50 border-red-200"
                      : urgency === "warning"
                      ? "bg-amber-50 border-amber-200"
                      : "bg-emerald-50 border-emerald-200"
                  }`}
                >
                  <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">SOL Expires</div>
                  <div className="text-2xl font-bold text-slate-900">{fmt(solDate)}</div>
                  {solDays !== null && (
                    <div className="text-xs text-slate-500 mt-0.5">
                      {solDays >= 0 ? `${solDays} days from today` : `${Math.abs(solDays)} days past — review immediately`}
                    </div>
                  )}
                </div>

                <Field label="Override SOL date (if attorney determines a different date applies)">
                  <input
                    type="date"
                    value={form.solOverride}
                    onChange={(e) => update("solOverride", e.target.value)}
                    className="input"
                  />
                </Field>

                {caseType.flag && (
                  <div className="mt-3 flex gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
                    <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-800">{caseType.flag}</p>
                  </div>
                )}
                {form.isMinor && (
                  <div className="mt-3 flex gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
                    <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-800">
                      Minor plaintiff — SOL may be tolled until age 18 under Tex. Civ. Prac. & Rem. Code §16.001. Medical malpractice claims follow the separate rule in §74.251(b). Confirm with attorney before relying on the calculated date above.
                    </p>
                  </div>
                )}

                <div className="mt-3 text-[11px] text-slate-400 leading-relaxed">
                  This is plain date math applied to the rule shown above — it is not a legal determination. An attorney must confirm the SOL before it's relied on.
                </div>
              </>
            )}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Calendar size={18} className="text-slate-500" />
                <h2 className="font-semibold text-slate-800">Calendar Reminders</h2>
              </div>
            </div>
            {!solDate ? (
              <p className="text-sm text-slate-400">Reminders will appear once an SOL date is calculated.</p>
            ) : (
              <>
                <ul className="space-y-2 mb-4">
                  {reminders.map((r) => (
                    <li key={r.offset} className="flex items-center justify-between text-sm">
                      <span className="text-slate-600">{r.label}</span>
                      <span className="font-medium text-slate-900">{fmt(r.date)}</span>
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => setReminderModal({ client: form.clientName || "(unsaved intake)", reminders })}
                  className="w-full text-sm font-semibold border border-slate-900 text-slate-900 rounded-lg py-2 hover:bg-slate-900 hover:text-white transition"
                >
                  Review & Push to Higdon Lawyers Calendar
                </button>
                <p className="text-[11px] text-slate-400 mt-2">
                  This stages the events for review — nothing is written to Google Calendar from this screen. Confirm the list with Claude in chat to actually create them.
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Intake list */}
      <div className="max-w-6xl mx-auto px-6 pb-16">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <FileText size={18} className="text-slate-500" />
              <h2 className="font-semibold text-slate-800">Saved Intakes ({filtered.length})</h2>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search client, case #, defendant"
                  className="pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg w-64"
                />
              </div>
              <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs font-medium">
                {[{ id: "all", label: "All" }, ...INSURANCE_TYPES].map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setFilter(f.id)}
                    className={`px-3 py-1.5 ${filter === f.id ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-400">
              {intakes.length === 0 ? "No intakes saved yet." : "No intakes match this filter."}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                  <th className="px-6 py-3 font-semibold">Client</th>
                  <th className="px-3 py-3 font-semibold">Case #</th>
                  <th className="px-3 py-3 font-semibold">Case Type</th>
                  <th className="px-3 py-3 font-semibold">DOA</th>
                  <th className="px-3 py-3 font-semibold">SOL</th>
                  <th className="px-3 py-3 font-semibold">Insurance</th>
                  <th className="px-3 py-3 font-semibold">Carrier</th>
                  <th className="px-3 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((i) => {
                  const days = daysUntil(new Date(i.solDate + "T00:00:00"));
                  return (
                    <tr key={i.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                      <td className="px-6 py-3 font-medium">{i.clientName}</td>
                      <td className="px-3 py-3 text-slate-500">{i.caseNumber || "—"}</td>
                      <td className="px-3 py-3 text-slate-500">{CASE_TYPES.find((c) => c.id === i.caseType)?.label}</td>
                      <td className="px-3 py-3 text-slate-500">{i.doa}</td>
                      <td className="px-3 py-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            days !== null && days < 30
                              ? "bg-red-100 text-red-700"
                              : days !== null && days < 90
                              ? "bg-amber-100 text-amber-700"
                              : "bg-emerald-100 text-emerald-700"
                          }`}
                        >
                          {i.solDate}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-slate-500 capitalize">{i.insuranceType}</td>
                      <td className="px-3 py-3 text-slate-500">{i.carrier || "—"}</td>
                      <td className="px-3 py-3 text-right">
                        <button onClick={() => deleteIntake(i.id)} className="text-slate-300 hover:text-red-500">
                          <X size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {reminderModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50" onClick={() => setReminderModal(null)}>
          <div className="bg-white rounded-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-slate-800 mb-1">Reminders to create</h3>
            <p className="text-xs text-slate-400 mb-4">Higdon Lawyers calendar — {reminderModal.client}</p>
            <ul className="space-y-2 mb-5">
              {reminderModal.reminders.map((r) => (
                <li key={r.offset} className="flex items-center justify-between text-sm bg-slate-50 rounded-lg px-3 py-2">
                  <span>{r.label}</span>
                  <span className="font-medium">{fmt(r.date)}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-slate-500 mb-4">
              Copy this client's name and these dates into chat and ask Claude to add them to the Higdon Lawyers Google Calendar — Claude will confirm before creating anything.
            </p>
            <button onClick={() => setReminderModal(null)} className="w-full bg-slate-900 text-white rounded-lg py-2 text-sm font-semibold">
              Close
            </button>
          </div>
        </div>
      )}

      <style>{`
        .input {
          width: 100%;
          border: 1px solid #e2e8f0;
          border-radius: 0.5rem;
          padding: 0.55rem 0.75rem;
          font-size: 0.875rem;
          outline: none;
          transition: border-color 0.15s;
          background: white;
        }
        .input:focus {
          border-color: #0f172a;
        }
      `}</style>
    </div>
  );
}

function Field({ label, required, children }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}
