import React, { useState, useEffect, useMemo, useRef } from "react";
import Papa from "papaparse";
import {
  Search, LayoutDashboard, FolderOpen, CheckSquare, Bell, Calendar, Settings,
  Plus, X, ChevronRight, Check, Copy, Upload, AlertCircle, AlertTriangle,
  TrendingUp, Clock, CheckCircle2, ExternalLink, Link2, Sparkles, Printer, RefreshCw,
} from "lucide-react";

/* ============================== SCHEMA ============================== */
const FIELDS = [
  { key: "clientName", label: "Client Name", type: "text", section: "Case Info" },
  { key: "caseNumber", label: "Case Number", type: "text", section: "Case Info" },
  { key: "attorney", label: "Attorney", type: "text", section: "Case Info" },
  { key: "status", label: "Status", type: "select", options: ["Open", "Closed", "Settled - Not Disbursed", "Default Judgment"], section: "Case Info" },
  { key: "openDate", label: "Date Opened", type: "date", section: "Case Info" },
  { key: "doa", label: "DOA", type: "date", section: "Case Info" },
  { key: "sol", label: "SOL", type: "date", section: "Case Info" },
  { key: "opposingCounsel", label: "Opposing Counsel", type: "text", section: "Case Info" },
  { key: "trialDate", label: "Trial Date", type: "date", section: "Case Info" },
  { key: "dco", label: "DCO", type: "date", section: "Case Info" },
  { key: "insurance", label: "Insurance", type: "text", section: "Case Info" },
  { key: "commercial", label: "Commercial / Personal Lines", type: "select", options: ["Commercial", "Personal Lines", "Self-Insured / Government", "Unknown"], section: "Case Info" },
  { key: "referral", label: "Referral", type: "text", section: "Case Info" },
  { key: "crossRefCase", label: "Cross-Ref Case", type: "text", section: "Case Info" },
  { key: "suitFiled", label: "Suit Filed", type: "yesnoDoc", section: "Litigation Checklist" },
  { key: "served", label: "Served", type: "yesnoDoc", section: "Litigation Checklist" },
  { key: "answerFiled", label: "Answer Filed", type: "yesnoDoc", section: "Litigation Checklist" },
  { key: "plDiscoverySent", label: "Plaintiff's Discovery Sent", type: "yesnoDoc", section: "Litigation Checklist" },
  { key: "plDiscoveryAnswered", label: "Plaintiff's Discovery Answered", type: "yesnoDoc", section: "Litigation Checklist" },
  { key: "defDiscoveryReceived", label: "Defendant's Discovery Received", type: "yesnoDoc", section: "Litigation Checklist" },
  { key: "defDiscoveryAnswered", label: "Defendant's Discovery Answered", type: "yesnoDoc", section: "Litigation Checklist" },
  { key: "recordsOrdered", label: "Records Ordered", type: "yesnoDoc", section: "Litigation Checklist" },
  { key: "affidavitsFiled", label: "Affidavits Filed", type: "yesnoDoc", section: "Litigation Checklist" },
  { key: "plDepo", label: "Plaintiff's Deposition", type: "yesnoDoc", section: "Litigation Checklist" },
  { key: "defDepo", label: "Defendant's Deposition", type: "yesnoDoc", section: "Litigation Checklist" },
  { key: "mediation", label: "Mediation", type: "yesnoDoc", section: "Litigation Checklist" },
  { key: "treatmentDone", label: "Treatment Done?", type: "yesnoDoc", section: "Litigation Checklist" },
  { key: "settlementAmount", label: "Settlement Amount", type: "text", section: "Financial" },
  { key: "settlementDate", label: "Settlement Date", type: "date", section: "Financial" },
  { key: "demands", label: "Demands", type: "textarea", section: "Financial" },
  { key: "howSettled", label: "How Settled", type: "text", section: "Financial" },
  { key: "checkStatus", label: "Check Status", type: "text", section: "Financial" },
];
const SECTIONS = ["Case Info", "Litigation Checklist", "Financial"];
const DOC_FIELDS = new Set(FIELDS.filter((f) => f.type === "yesnoDoc").map((f) => f.key));
const HEADER_MAP = [
  ["CLIENT NAME", "clientName"], ["CASE NUMBER", "caseNumber"], ["ATTORNEY", "attorney"],
  ["STATUS", "status"], ["DOA", "doa"], ["SOL", "sol"],
  ["OPPOSING COUNSEL", "opposingCounsel"], ["TRIAL DATE", "trialDate"], ["DCO", "dco"],
  ["SUIT FILED", "suitFiled"], ["SERVED", "served"], ["ANSWER FILED", "answerFiled"], ["ANSWERED", "answerFiled"],
  ["PLAINTIFF'S DISCOVERY SENT", "plDiscoverySent"], ["PLAINTIFF'S DISCOVERY ANSWERED", "plDiscoveryAnswered"],
  ["DEFENDANT'S DISCOVERY RECEIVED", "defDiscoveryReceived"], ["DEFENDANT'S DISCOVERY ANSWERED", "defDiscoveryAnswered"],
  ["TREATMENT DONE?", "treatmentDone"], ["STILL TREATING? YES/NO", "treatmentDone"],
  ["RECORDS ORDERED", "recordsOrdered"], ["AFFIDAVITS FILED", "affidavitsFiled"],
  ["PLAINTIFF'S DEPO", "plDepo"], ["DEFENDANT'S DEPO", "defDepo"], ["MEDIATION", "mediation"],
  ["INSURANCE", "insurance"], ["COMMERCIAL", "commercial"], ["REFERRAL", "referral"],
  ["CROSS-REF CASE", "crossRefCase"], ["SETTLEMENT AMOUNT", "settlementAmount"],
  ["SETTLEMENT DATE", "settlementDate"], ["DEMANDS", "demands"], ["HOW SETTLED", "howSettled"],
  ["CHECK STATUS", "checkStatus"],
].sort((a, b) => b[0].length - a[0].length);

function normalizeHeader(h) { return (h || "").toString().trim().toUpperCase().replace(/\s+/g, " "); }
function guessField(header) {
  const norm = normalizeHeader(header);
  for (const [key, field] of HEADER_MAP) if (norm.startsWith(key)) return field;
  return "";
}
function isYes(raw) { return /^\s*y(es)?\b/i.test((raw || "").toString()); }
function today() { return new Date().toISOString().slice(0, 10); }
function fmt(d) { if (!d) return "—"; return new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
function copyText(text, cb) { navigator.clipboard.writeText(text).then(() => cb && cb()).catch(() => {}); }
function emptyValues() {
  const v = {};
  FIELDS.forEach((f) => { v[f.key] = f.type === "yesnoDoc" ? { done: false, docUrl: "", note: "", date: "" } : ""; });
  return v;
}

/* ============================== DEADLINE CHAIN ============================== */
function addDays(dateStr, days) { const d = new Date(dateStr + "T00:00:00"); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); }
function nextMondayOnOrAfter(dateStr) { const d = new Date(dateStr + "T00:00:00"); const day = d.getDay(); const diff = (1 - day + 7) % 7; d.setDate(d.getDate() + diff); return d.toISOString().slice(0, 10); }
const CHAIN_RULES = [
  { key: "served", title: "Answer Due", note: "Tex. R. Civ. P. 99 — Monday next after 20 days from service. Confirm with attorney.", getDue: (v) => (v.served?.done && v.served?.date ? nextMondayOnOrAfter(addDays(v.served.date, 20)) : null) },
  { key: "plDiscoverySent", title: "Defendant's Discovery Response Due", note: "Tex. R. Civ. P. 196/197 — 30 days. Confirm with attorney.", getDue: (v) => (v.plDiscoverySent?.done && v.plDiscoverySent?.date ? addDays(v.plDiscoverySent.date, 30) : null) },
  { key: "defDiscoveryReceived", title: "Plaintiff's Discovery Response Due", note: "Tex. R. Civ. P. 196/197 — 30 days. Confirm with attorney.", getDue: (v) => (v.defDiscoveryReceived?.done && v.defDiscoveryReceived?.date ? addDays(v.defDiscoveryReceived.date, 30) : null) },
  { key: "sol", title: "Statute of Limitations", note: "From matter record.", getDue: (v) => v.sol || null },
  { key: "trialDate", title: "Trial", note: "From matter record.", getDue: (v) => v.trialDate || null },
  { key: "dco", title: "Docket Control Order Deadline", note: "From matter record.", getDue: (v) => v.dco || null },
  { key: "recordsOrdered", title: "Follow Up on Medical Records", note: "Internal — 30 days after ordered.", getDue: (v) => (v.recordsOrdered?.done && v.recordsOrdered?.date ? addDays(v.recordsOrdered.date, 30) : null) },
  { key: "plDepo", title: "Send Deposition Transcript for Review", note: "Internal — 14 days after deposition.", getDue: (v) => (v.plDepo?.done && v.plDepo?.date ? addDays(v.plDepo.date, 14) : null) },
];
function generateChainTasks(matters, existingTasks) {
  const tasks = { ...existingTasks };
  Object.entries(matters).forEach(([matterId, m]) => {
    CHAIN_RULES.forEach((rule) => {
      const due = rule.getDue(m.values);
      const id = `auto:${matterId}:${rule.key}`;
      if (!due) { if (tasks[id] && !tasks[id].completed && !tasks[id].manualOverride) delete tasks[id]; return; }
      const existing = tasks[id];
      tasks[id] = {
        id, matterId, title: rule.title, note: rule.note,
        dueDate: existing?.manualOverride ? existing.dueDate : due, autoDueDate: due,
        manualOverride: existing?.manualOverride || false,
        assignedTo: existing?.assignedTo || m.values.attorney || "Unassigned",
        completed: existing?.completed || false, calendarSynced: existing?.calendarSynced || false,
        source: "auto",
      };
    });
  });
  return tasks;
}

/* ============================== APP SHELL ============================== */
export default function CaseManagementSystem() {
  const [view, setView] = useState("dashboard");
  const [matters, setMatters] = useState({});
  const [tasksMap, setTasksMap] = useState({});
  const [team, setTeam] = useState({});
  const [queue, setQueue] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [selectedMatterId, setSelectedMatterId] = useState(null);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    (async () => {
      let m = {}, t = {}, tm = {}, q = {};
      try { const r = await window.storage.get("case-records", false); if (r?.value) m = JSON.parse(r.value); } catch (e) {}
      try { const r = await window.storage.get("firm-tasks", false); if (r?.value) t = JSON.parse(r.value); } catch (e) {}
      try { const r = await window.storage.get("team-directory", false); if (r?.value) tm = JSON.parse(r.value); } catch (e) {}
      try { const r = await window.storage.get("notification-queue", false); if (r?.value) q = JSON.parse(r.value); } catch (e) {}
      const regenerated = generateChainTasks(m, t);
      setMatters(m); setTasksMap(regenerated); setTeam(tm); setQueue(q);
      window.storage.set("firm-tasks", JSON.stringify(regenerated), false).catch(() => {});
      setLoaded(true);
    })();
  }, []);

  function persistMatters(next) {
    setMatters(next);
    window.storage.set("case-records", JSON.stringify(next), false).catch(() => {});
    const regenerated = generateChainTasks(next, tasksMap);
    setTasksMap(regenerated);
    window.storage.set("firm-tasks", JSON.stringify(regenerated), false).catch(() => {});
  }
  function persistTasks(next) { setTasksMap(next); window.storage.set("firm-tasks", JSON.stringify(next), false).catch(() => {}); }
  function persistTeam(next) { setTeam(next); window.storage.set("team-directory", JSON.stringify(next), false).catch(() => {}); }
  function persistQueue(next) { setQueue(next); window.storage.set("notification-queue", JSON.stringify(next), false).catch(() => {}); }

  const searchResults = useMemo(() => {
    if (!search.trim()) return [];
    const s = search.toLowerCase();
    return Object.entries(matters)
      .filter(([, m]) => (m.values.clientName || "").toLowerCase().includes(s) || (m.values.caseNumber || "").toLowerCase().includes(s))
      .slice(0, 8);
  }, [search, matters]);

  function goToMatter(id) {
    setSelectedMatterId(id);
    setView("cases");
    setSearch("");
    setSearchOpen(false);
  }

  if (!loaded) return <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-slate-400">Loading…</div>;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900" style={{ fontFamily: "'IBM Plex Sans','Inter',system-ui,sans-serif" }}>
      <div className="bg-slate-900 text-white sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center gap-6">
          <div className="text-sm font-bold whitespace-nowrap">Higdon Lawyers</div>
          <nav className="flex items-center gap-1">
            {[
              { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
              { id: "cases", label: "Cases", icon: FolderOpen },
              { id: "tasks", label: "Tasks", icon: CheckSquare },
            ].map((t) => (
              <button key={t.id} onClick={() => setView(t.id)} className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg ${view === t.id ? "bg-slate-700 text-white" : "text-slate-300 hover:bg-slate-800"}`}>
                <t.icon size={14} /> {t.label}
              </button>
            ))}
          </nav>
          <div className="flex-1 relative max-w-md ml-auto">
            <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setSearchOpen(true); }}
              onFocus={() => setSearchOpen(true)}
              placeholder="Search for a case…"
              className="w-full bg-slate-800 text-white placeholder-slate-400 text-sm rounded-full pl-9 pr-3 py-1.5 outline-none focus:bg-slate-700"
            />
            {searchOpen && search.trim() && (
              <div className="absolute top-full mt-1 left-0 right-0 bg-white rounded-lg shadow-lg border border-slate-200 overflow-hidden z-50" onMouseLeave={() => setSearchOpen(false)}>
                {searchResults.length === 0 ? (
                  <div className="px-4 py-3 text-sm text-slate-400">No matching cases.</div>
                ) : (
                  searchResults.map(([id, m]) => (
                    <button key={id} onClick={() => goToMatter(id)} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 flex items-center justify-between border-b border-slate-50 last:border-0">
                      <span className="text-sm font-medium text-slate-800">{m.values.clientName}</span>
                      <span className="text-xs text-slate-400">{m.values.caseNumber || "no #"}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {view === "dashboard" && <DashboardPanel matters={matters} tasksMap={tasksMap} team={team} queue={queue} persistQueue={persistQueue} goToMatter={goToMatter} />}
      {view === "cases" && <CasesPanel matters={matters} persistMatters={persistMatters} selectedMatterId={selectedMatterId} setSelectedMatterId={setSelectedMatterId} />}
      {view === "tasks" && <TasksPanel matters={matters} tasksMap={tasksMap} persistTasks={persistTasks} team={team} persistTeam={persistTeam} queue={queue} persistQueue={persistQueue} goToMatter={goToMatter} />}
    </div>
  );
}

/* ============================== CASES PANEL ============================== */
function CasesPanel({ matters, persistMatters, selectedMatterId, setSelectedMatterId }) {
  const [search, setSearch] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [docPrompt, setDocPrompt] = useState(null);
  const [docDraft, setDocDraft] = useState("");
  const [importState, setImportState] = useState(null);
  const fileRef = useRef(null);

  const list = Object.entries(matters).sort((a, b) => (a[1].values.clientName || "").localeCompare(b[1].values.clientName || ""));
  const filtered = list.filter(([, m]) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (m.values.clientName || "").toLowerCase().includes(s) || (m.values.caseNumber || "").toLowerCase().includes(s);
  });
  const active = selectedMatterId ? matters[selectedMatterId] : null;

  function createMatter(name) {
    const id = crypto.randomUUID();
    const values = emptyValues();
    if (name) values.clientName = name;
    values.openDate = today();
    values.lastActivityAt = new Date().toISOString();
    persistMatters({ ...matters, [id]: { values } });
    return id;
  }
  function updateField(id, key, patch) {
    const m = matters[id];
    const field = FIELDS.find((f) => f.key === key);
    const newVal = field.type === "yesnoDoc" ? { ...m.values[key], ...patch } : patch;
    persistMatters({ ...matters, [id]: { ...m, values: { ...m.values, [key]: newVal, lastActivityAt: new Date().toISOString() } } });
  }
  function handleYesClick(key) {
    const state = active.values[key];
    if (!state.done) { updateField(selectedMatterId, key, { done: true, date: state.date || today() }); setDocDraft(""); setDocPrompt(key); return; }
    if (state.docUrl) window.open(state.docUrl, "_blank", "noopener,noreferrer");
    else { setDocDraft(""); setDocPrompt(key); }
  }
  function saveDoc() { updateField(selectedMatterId, docPrompt, { docUrl: docDraft.trim() }); setDocPrompt(null); }

  function onFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: (results) => {
        const headers = results.meta.fields || [];
        const mapping = {};
        headers.forEach((h) => (mapping[h] = guessField(h)));
        setImportState({ headers, rows: results.data, mapping });
      },
    });
    e.target.value = "";
  }
  function confirmImport() {
    const { rows, mapping } = importState;
    const next = { ...matters };
    rows.forEach((row) => {
      const clientNameCol = Object.keys(mapping).find((h) => mapping[h] === "clientName");
      const name = clientNameCol ? row[clientNameCol] : "";
      if (!name) return;
      const id = crypto.randomUUID();
      const values = emptyValues();
      Object.entries(mapping).forEach(([header, fieldKey]) => {
        if (!fieldKey) return;
        const raw = row[header];
        if (raw === undefined || raw === null || raw === "") return;
        if (DOC_FIELDS.has(fieldKey)) values[fieldKey] = { done: isYes(raw), docUrl: "", note: isYes(raw) ? "" : raw, date: "" };
        else values[fieldKey] = raw;
      });
      values.openDate = values.openDate || today();
      next[id] = { values };
    });
    persistMatters(next);
    setImportState(null);
  }

  const bySection = (section) => FIELDS.filter((f) => f.section === section);

  return (
    <div className="max-w-7xl mx-auto px-6 py-6 grid grid-cols-1 lg:grid-cols-4 gap-6">
      <div className="lg:col-span-1">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="p-4 border-b border-slate-200 space-y-3">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter list" className="input pl-8" />
            </div>
            <div className="flex gap-2">
              {!newOpen ? (
                <button onClick={() => setNewOpen(true)} className="flex-1 flex items-center justify-center gap-1.5 text-sm font-semibold border border-slate-900 text-slate-900 rounded-lg py-2 hover:bg-slate-900 hover:text-white transition">
                  <Plus size={15} /> New Matter
                </button>
              ) : (
                <div className="flex gap-2 flex-1">
                  <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Client name" className="input" autoFocus
                    onKeyDown={(e) => { if (e.key === "Enter" && newName.trim()) { setSelectedMatterId(createMatter(newName.trim())); setNewName(""); setNewOpen(false); } }} />
                  <button onClick={() => { if (newName.trim()) { setSelectedMatterId(createMatter(newName.trim())); setNewName(""); setNewOpen(false); } }} className="bg-slate-900 text-white text-sm font-semibold rounded-lg px-3">Add</button>
                </div>
              )}
            </div>
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={onFile} />
            <button onClick={() => fileRef.current.click()} className="w-full flex items-center justify-center gap-1.5 text-xs border border-slate-200 rounded-lg py-1.5 text-slate-500 hover:border-slate-400">
              <Upload size={13} /> Import CSV
            </button>
          </div>
          <div className="max-h-[560px] overflow-y-auto">
            {filtered.length === 0 ? <div className="p-6 text-center text-xs text-slate-400">No matters yet.</div> : filtered.map(([id, m]) => (
              <button key={id} onClick={() => setSelectedMatterId(id)} className={`w-full text-left px-4 py-3 border-b border-slate-50 flex items-center justify-between gap-2 ${id === selectedMatterId ? "bg-slate-50" : "hover:bg-slate-50/60"}`}>
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{m.values.clientName || "(unnamed)"}</div>
                  <div className="text-[11px] text-slate-400">{m.values.caseNumber || "no case #"}</div>
                </div>
                <ChevronRight size={14} className="text-slate-300 shrink-0" />
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="lg:col-span-3">
        {!active ? (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-10 text-center text-sm text-slate-400">
            Use the search bar above, pick a matter from the list, or create a new one.
          </div>
        ) : (
          <div className="space-y-6">
            {SECTIONS.map((section) => (
              <div key={section} className="bg-white rounded-xl border border-slate-200 shadow-sm">
                <div className="px-6 py-3 border-b border-slate-200"><h2 className="font-semibold text-slate-800 text-sm">{section}</h2></div>
                {section === "Litigation Checklist" ? (
                  <div className="divide-y divide-slate-50">
                    {bySection(section).map((f) => {
                      const state = active.values[f.key];
                      return (
                        <div key={f.key} className="px-6 py-3.5 flex items-center gap-4">
                          <button onClick={() => handleYesClick(f.key)} title={!state.done ? "Mark done" : state.docUrl ? "Open document" : "Attach a document"}
                            className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center border transition ${state.done ? "bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-700" : "border-slate-300 hover:border-slate-500"}`}>
                            {state.done ? (state.docUrl ? <ExternalLink size={15} /> : <Check size={15} />) : null}
                          </button>
                          <div className="flex-1 min-w-0">
                            <div className={`text-sm font-medium ${state.done ? "text-slate-800" : "text-slate-500"}`}>{f.label}</div>
                            {state.done && (
                              <input type="date" value={state.date || ""} onChange={(e) => updateField(selectedMatterId, f.key, { date: e.target.value })} className="text-[11px] text-slate-400 border-0 p-0 bg-transparent mt-0.5 focus:outline-none" />
                            )}
                            {state.note && <div className="text-[11px] text-slate-400 mt-0.5">imported note: "{state.note}"</div>}
                            {state.done && !state.docUrl && <button onClick={() => { setDocDraft(""); setDocPrompt(f.key); }} className="text-[11px] text-amber-600 hover:underline mt-0.5">attach document</button>}
                            {state.docUrl && <div className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5"><Link2 size={10} /> document linked</div>}
                          </div>
                          {state.done && <button onClick={() => updateField(selectedMatterId, f.key, { done: false, docUrl: "", note: "" })} className="text-slate-300 hover:text-red-500 shrink-0"><X size={14} /></button>}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="p-6 grid grid-cols-2 gap-4">
                    {bySection(section).map((f) => (
                      <div key={f.key} className={f.type === "textarea" ? "col-span-2" : ""}>
                        <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">{f.label}</label>
                        {f.type === "select" ? (
                          <select className="input" value={active.values[f.key]} onChange={(e) => updateField(selectedMatterId, f.key, e.target.value)}>
                            <option value="">—</option>{f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                          </select>
                        ) : f.type === "textarea" ? (
                          <textarea className="input resize-none" rows={2} value={active.values[f.key]} onChange={(e) => updateField(selectedMatterId, f.key, e.target.value)} />
                        ) : (
                          <input type={f.type === "date" ? "date" : "text"} className="input" value={active.values[f.key]} onChange={(e) => updateField(selectedMatterId, f.key, e.target.value)} />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {docPrompt && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50" onClick={() => setDocPrompt(null)}>
          <div className="bg-white rounded-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-slate-800 mb-1">Link the document</h3>
            <p className="text-xs text-slate-400 mb-4">Paste the Dropbox link. Clicking it again opens the document directly.</p>
            <input value={docDraft} onChange={(e) => setDocDraft(e.target.value)} placeholder="https://dropbox.com/…" className="input mb-4" autoFocus onKeyDown={(e) => e.key === "Enter" && saveDoc()} />
            <div className="flex gap-2">
              <button onClick={saveDoc} className="flex-1 bg-slate-900 text-white rounded-lg py-2 text-sm font-semibold">Save Link</button>
              <button onClick={() => setDocPrompt(null)} className="text-sm text-slate-400 px-3">Skip</button>
            </div>
          </div>
        </div>
      )}

      {importState && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50" onClick={() => setImportState(null)}>
          <div className="bg-white rounded-xl max-w-2xl w-full p-6 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-slate-800 mb-1">Review column mapping</h3>
            <p className="text-xs text-slate-400 mb-4">{importState.rows.length} rows found. Fix any mapping before importing.</p>
            <div className="space-y-1.5 mb-5">
              {importState.headers.map((h) => (
                <div key={h} className="flex items-center gap-3 text-sm">
                  <div className="w-1/2 truncate text-slate-600">{h}</div>
                  <ChevronRight size={13} className="text-slate-300 shrink-0" />
                  <select className="input flex-1" value={importState.mapping[h]} onChange={(e) => setImportState((s) => ({ ...s, mapping: { ...s.mapping, [h]: e.target.value } }))}>
                    <option value="">(ignore this column)</option>
                    {FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </select>
                </div>
              ))}
            </div>
            {!Object.values(importState.mapping).includes("clientName") && (
              <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
                <AlertCircle size={14} /> No column mapped to Client Name — rows without it will be skipped.
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={confirmImport} className="flex-1 bg-slate-900 text-white rounded-lg py-2 text-sm font-semibold">Import {importState.rows.length} Rows</button>
              <button onClick={() => setImportState(null)} className="text-sm text-slate-400 px-3">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================== TASKS PANEL ============================== */
function TasksPanel({ matters, tasksMap, persistTasks, team, persistTeam, queue, persistQueue, goToMatter }) {
  const [filterIncomplete, setFilterIncomplete] = useState(true);
  const [filterAssignee, setFilterAssignee] = useState("");
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [newTask, setNewTask] = useState({ matterId: "", title: "", assignedTo: "", dueDate: "" });
  const [teamOpen, setTeamOpen] = useState(false);
  const [teamDraft, setTeamDraft] = useState({ name: "", email: "" });
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarSelected, setCalendarSelected] = useState({});
  const [copiedId, setCopiedId] = useState(null);

  function toggleComplete(id) { persistTasks({ ...tasksMap, [id]: { ...tasksMap[id], completed: !tasksMap[id].completed } }); }
  function deleteTask(id) { const next = { ...tasksMap }; delete next[id]; persistTasks(next); }
  function addManualTask() {
    if (!newTask.title.trim() || !newTask.matterId) return;
    const id = crypto.randomUUID();
    persistTasks({ ...tasksMap, [id]: { id, matterId: newTask.matterId, title: newTask.title, assignedTo: newTask.assignedTo || "Unassigned", dueDate: newTask.dueDate, completed: false, source: "manual" } });
    setNewTask({ matterId: "", title: "", assignedTo: "", dueDate: "" });
    setNewTaskOpen(false);
  }
  function markCalendarSynced(ids) { const next = { ...tasksMap }; ids.forEach((id) => { next[id] = { ...next[id], calendarSynced: true }; }); persistTasks(next); }
  function addTeamMember() { if (!teamDraft.name.trim() || !teamDraft.email.trim()) return; persistTeam({ ...team, [teamDraft.name.trim()]: teamDraft.email.trim() }); setTeamDraft({ name: "", email: "" }); }
  function removeTeamMember(name) { const next = { ...team }; delete next[name]; persistTeam(next); }
  function dismissNotification(id) { const next = { ...queue }; delete next[id]; persistQueue(next); }

  const assignees = useMemo(() => Array.from(new Set(Object.values(tasksMap).map((t) => t.assignedTo).filter(Boolean))), [tasksMap]);
  const list = useMemo(() => Object.values(tasksMap)
    .filter((t) => (filterIncomplete ? !t.completed : true))
    .filter((t) => (filterAssignee ? t.assignedTo === filterAssignee : true))
    .sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999")), [tasksMap, filterIncomplete, filterAssignee]);
  const grouped = useMemo(() => {
    const g = {};
    list.forEach((t) => {
      const m = matters[t.matterId];
      const key = t.matterId;
      if (!g[key]) g[key] = { label: m ? `${m.values.clientName} (${m.values.caseNumber || "no #"})` : "Unknown matter", items: [] };
      g[key].items.push(t);
    });
    return g;
  }, [list, matters]);
  const unsyncedForCalendar = useMemo(() => Object.values(tasksMap).filter((t) => !t.completed && t.dueDate && !t.calendarSynced), [tasksMap]);

  function daysFromToday(dateStr) { const now = new Date(); now.setHours(0, 0, 0, 0); const d = new Date(dateStr + "T00:00:00"); return Math.round((d - now) / 86400000); }

  return (
    <div className="max-w-5xl mx-auto px-6 py-6">
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <button onClick={() => setFilterIncomplete((v) => !v)} className={`text-xs font-medium rounded-full px-3 py-1.5 border ${filterIncomplete ? "bg-slate-900 text-white border-slate-900" : "border-slate-300 text-slate-600"}`}>Incomplete</button>
        <select value={filterAssignee} onChange={(e) => setFilterAssignee(e.target.value)} className="text-xs border border-slate-300 rounded-full px-3 py-1.5 bg-white">
          <option value="">All Assignees</option>{assignees.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <div className="flex-1" />
        <button onClick={() => setCalendarOpen(true)} className="flex items-center gap-1.5 text-xs bg-slate-800 text-white hover:bg-slate-700 rounded-full px-3 py-1.5"><Calendar size={13} /> Sync to Calendar</button>
        <button onClick={() => setTeamOpen(true)} className="flex items-center gap-1.5 text-xs bg-slate-800 text-white hover:bg-slate-700 rounded-full px-3 py-1.5"><Settings size={13} /> Team</button>
        <button onClick={() => setNewTaskOpen(true)} className="flex items-center gap-1.5 text-xs font-semibold bg-slate-900 text-white rounded-full px-3 py-1.5"><Plus size={13} /> Add Task</button>
      </div>

      {Object.keys(grouped).length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-sm text-slate-400">Nothing here.</div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([matterId, group]) => (
            <div key={matterId} className="bg-white rounded-xl border border-slate-200 shadow-sm">
              <button onClick={() => goToMatter(matterId)} className="w-full text-left px-5 py-3 border-b border-slate-100 hover:bg-slate-50">
                <h2 className="text-sm font-semibold text-teal-700">{group.label}</h2>
              </button>
              <div className="divide-y divide-slate-50">
                {group.items.map((t) => {
                  const days = t.dueDate ? daysFromToday(t.dueDate) : null;
                  const overdue = days !== null && days < 0 && !t.completed;
                  return (
                    <div key={t.id} className="px-5 py-3.5 flex items-center gap-3">
                      <button onClick={() => toggleComplete(t.id)} className="shrink-0 text-slate-300 hover:text-emerald-600">
                        {t.completed ? <CheckCircle2 size={20} className="text-emerald-600" /> : <div className="w-5 h-5 rounded-full border-2 border-slate-300" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className={`text-sm font-medium ${t.completed ? "text-slate-400 line-through" : "text-slate-800"}`}>{t.title}</div>
                        <div className="text-[11px] text-slate-400 flex items-center gap-2"><span>Assigned to {t.assignedTo}</span>{t.note && <span>· {t.note}</span>}</div>
                      </div>
                      <div className="text-xs text-right shrink-0">
                        <div className={`font-medium ${overdue ? "text-red-600" : "text-slate-600"}`}>{fmt(t.dueDate)}</div>
                        {overdue && <div className="text-[10px] font-semibold text-red-600">OVERDUE</div>}
                      </div>
                      {t.source === "manual" && <button onClick={() => deleteTask(t.id)} className="text-slate-300 hover:text-red-500 shrink-0"><X size={14} /></button>}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {newTaskOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50" onClick={() => setNewTaskOpen(false)}>
          <div className="bg-white rounded-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-slate-800 mb-4">Add Task</h3>
            <div className="space-y-3">
              <select className="input" value={newTask.matterId} onChange={(e) => setNewTask((n) => ({ ...n, matterId: e.target.value }))}>
                <option value="">Select matter…</option>{Object.entries(matters).map(([id, m]) => <option key={id} value={id}>{m.values.clientName} ({m.values.caseNumber || "no #"})</option>)}
              </select>
              <input className="input" placeholder="Task title" value={newTask.title} onChange={(e) => setNewTask((n) => ({ ...n, title: e.target.value }))} />
              <input className="input" placeholder="Assigned to" value={newTask.assignedTo} onChange={(e) => setNewTask((n) => ({ ...n, assignedTo: e.target.value }))} />
              <input type="date" className="input" value={newTask.dueDate} onChange={(e) => setNewTask((n) => ({ ...n, dueDate: e.target.value }))} />
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={addManualTask} className="flex-1 bg-slate-900 text-white rounded-lg py-2 text-sm font-semibold">Add</button>
              <button onClick={() => setNewTaskOpen(false)} className="text-sm text-slate-400 px-3">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {calendarOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50" onClick={() => setCalendarOpen(false)}>
          <div className="bg-white rounded-xl max-w-lg w-full p-6 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1"><h3 className="font-semibold text-slate-800">Sync to Higdon Lawyers Calendar</h3><button onClick={() => setCalendarOpen(false)}><X size={16} className="text-slate-400" /></button></div>
            <p className="text-xs text-slate-400 mb-4">Copy the list, paste it in chat, and confirm — Claude will create the real events, then come back and mark them synced.</p>
            {unsyncedForCalendar.length === 0 ? <p className="text-sm text-slate-400 text-center py-6">Everything's synced.</p> : (
              <>
                <div className="space-y-2 mb-4">
                  {unsyncedForCalendar.map((t) => {
                    const m = matters[t.matterId];
                    return (
                      <label key={t.id} className="flex items-center gap-2 text-sm bg-slate-50 rounded-lg px-3 py-2">
                        <input type="checkbox" checked={calendarSelected[t.id] ?? true} onChange={(e) => setCalendarSelected((s) => ({ ...s, [t.id]: e.target.checked }))} />
                        <span className="flex-1">{t.title} — {m ? m.values.clientName : "?"}</span>
                        <span className="text-slate-500">{fmt(t.dueDate)}</span>
                      </label>
                    );
                  })}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => {
                    const selected = unsyncedForCalendar.filter((t) => calendarSelected[t.id] ?? true);
                    const text = selected.map((t) => { const m = matters[t.matterId]; return `${t.title} — ${m ? m.values.clientName : "?"} (${m?.values.caseNumber || "no #"}) — due ${fmt(t.dueDate)}`; }).join("\n");
                    copyText(`Please add these to the Higdon Lawyers Google Calendar:\n\n${text}`, () => { setCopiedId("cal"); setTimeout(() => setCopiedId(null), 1500); });
                  }} className="flex-1 flex items-center justify-center gap-1.5 bg-slate-900 text-white rounded-lg py-2 text-sm font-semibold">
                    {copiedId === "cal" ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy List for Chat</>}
                  </button>
                  <button onClick={() => { const ids = unsyncedForCalendar.filter((t) => calendarSelected[t.id] ?? true).map((t) => t.id); markCalendarSynced(ids); setCalendarOpen(false); }} className="text-sm text-slate-500 border border-slate-200 rounded-lg px-3">Mark Synced</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {teamOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50" onClick={() => setTeamOpen(false)}>
          <div className="bg-white rounded-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4"><h3 className="font-semibold text-slate-800">Team Directory</h3><button onClick={() => setTeamOpen(false)}><X size={16} className="text-slate-400" /></button></div>
            <div className="space-y-2 mb-4 max-h-52 overflow-y-auto">
              {Object.entries(team).map(([name, email]) => (
                <div key={name} className="flex items-center justify-between text-sm bg-slate-50 rounded-lg px-3 py-2">
                  <span className="font-medium">{name}</span><span className="text-slate-500">{email}</span>
                  <button onClick={() => removeTeamMember(name)} className="text-slate-300 hover:text-red-500"><X size={13} /></button>
                </div>
              ))}
              {Object.keys(team).length === 0 && <p className="text-xs text-slate-400">No team members yet.</p>}
            </div>
            <div className="flex gap-2">
              <input className="input" placeholder="Name" value={teamDraft.name} onChange={(e) => setTeamDraft((d) => ({ ...d, name: e.target.value }))} />
              <input className="input" placeholder="Email" value={teamDraft.email} onChange={(e) => setTeamDraft((d) => ({ ...d, email: e.target.value }))} />
              <button onClick={addTeamMember} className="bg-slate-900 text-white rounded-lg px-3 text-sm font-semibold shrink-0">Add</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================== DASHBOARD PANEL ============================== */
function DashboardPanel({ matters, tasksMap, team, queue, persistQueue, goToMatter }) {
  const [briefOpen, setBriefOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const STALE_DAYS = 30;

  function daysSince(iso) { if (!iso) return null; return Math.floor((new Date() - new Date(iso)) / 86400000); }
  function lastActivity(values) {
    const candidates = [];
    if (values.lastActivityAt) candidates.push(values.lastActivityAt);
    (values.mailLog || []).forEach((m) => m.receivedDate && candidates.push(m.receivedDate));
    return candidates.length ? candidates.sort().reverse()[0] : null;
  }

  const entries = Object.entries(matters);
  const active = entries.filter(([, m]) => (m.values.status || "Open") === "Open");
  const openedThisMonth = useMemo(() => {
    const now = new Date();
    return active.filter(([, m]) => { const od = m.values.openDate; if (!od) return false; const d = new Date(od); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); }).length;
  }, [matters]);
  const needsAttention = useMemo(() => active.map(([id, m]) => {
    const anchor = lastActivity(m.values) || m.values.openDate;
    const days = daysSince(anchor);
    return { id, m, anchor, days };
  }).filter((x) => x.days === null || x.days >= STALE_DAYS).sort((a, b) => (b.days ?? 9999) - (a.days ?? 9999)), [matters]);

  const trialCountdown = useMemo(() => {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const tiers = { 30: [], 60: [], 90: [], 120: [] };
    active.forEach(([id, m]) => {
      const td = m.values.trialDate; if (!td) return;
      const days = Math.round((new Date(td + "T00:00:00") - now) / 86400000);
      if (days < 0) return;
      if (days <= 30) tiers[30].push({ id, m, days });
      else if (days <= 60) tiers[60].push({ id, m, days });
      else if (days <= 90) tiers[90].push({ id, m, days });
      else if (days <= 120) tiers[120].push({ id, m, days });
    });
    Object.values(tiers).forEach((l) => l.sort((a, b) => a.days - b.days));
    return tiers;
  }, [matters]);

  const overdueTasks = useMemo(() => Object.values(tasksMap).filter((t) => !t.completed && t.dueDate && new Date(t.dueDate + "T00:00:00") < new Date(new Date().toDateString())).sort((a, b) => a.dueDate.localeCompare(b.dueDate)), [tasksMap]);
  const upcomingDeadlines = useMemo(() => {
    const now = new Date(); const in90 = new Date(); in90.setDate(in90.getDate() + 90);
    const items = [];
    active.forEach(([id, m]) => {
      const v = m.values;
      if (v.sol) items.push({ id, name: v.clientName, label: "SOL", date: v.sol });
      if (v.trialDate) items.push({ id, name: v.clientName, label: "Trial Date", date: v.trialDate });
      if (v.dco) items.push({ id, name: v.clientName, label: "DCO", date: v.dco });
    });
    return items.filter((i) => { const d = new Date(i.date); return d >= now && d <= in90; }).sort((a, b) => new Date(a.date) - new Date(b.date));
  }, [matters]);
  const byAttorney = useMemo(() => {
    const g = {};
    active.forEach(([id, m]) => { const a = m.values.attorney || "Unassigned"; if (!g[a]) g[a] = []; g[a].push([id, m]); });
    return g;
  }, [matters]);

  function dismissNotification(id) { const next = { ...queue }; delete next[id]; persistQueue(next); }

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <div className="flex justify-end gap-2 -mt-2">
        <button onClick={() => setNotifOpen(true)} className="relative flex items-center gap-1.5 text-xs bg-slate-800 text-white hover:bg-slate-700 rounded-full px-3 py-1.5">
          <Bell size={13} /> Notifications
          {Object.keys(queue).length > 0 && <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center">{Object.keys(queue).length}</span>}
        </button>
        <button onClick={() => setBriefOpen(true)} className="flex items-center gap-1.5 text-xs bg-slate-800 text-white hover:bg-slate-700 rounded-full px-3 py-1.5"><Sparkles size={13} /> Today's Brief</button>
      </div>

      <div className="grid grid-cols-5 gap-4">
        <SnapshotCard icon={<FolderOpen size={18} />} label="Active Matters" value={active.length} />
        <SnapshotCard icon={<TrendingUp size={18} />} label="Opened This Month" value={openedThisMonth} />
        <SnapshotCard icon={<AlertTriangle size={18} />} label="Overdue Tasks" value={overdueTasks.length} accent={overdueTasks.length > 0} />
        <SnapshotCard icon={<AlertTriangle size={18} />} label="Inactive 30+ Days" value={needsAttention.length} accent={needsAttention.length > 0} />
        <SnapshotCard icon={<Clock size={18} />} label="Trial Within 120 Days" value={trialCountdown[30].length + trialCountdown[60].length + trialCountdown[90].length + trialCountdown[120].length} accent={trialCountdown[30].length > 0} />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-2">
          <AlertTriangle size={16} className="text-red-500" /><h2 className="font-semibold text-slate-800">Overdue Tasks</h2>
        </div>
        {overdueTasks.length === 0 ? <div className="p-8 text-center text-sm text-slate-400">Nothing overdue.</div> : (
          <div className="divide-y divide-slate-50">
            {overdueTasks.slice(0, 8).map((t) => {
              const m = matters[t.matterId];
              return (
                <button key={t.id} onClick={() => goToMatter(t.matterId)} className="w-full text-left px-6 py-3 flex items-center justify-between text-sm hover:bg-slate-50">
                  <div className="min-w-0"><span className="font-medium text-slate-800">{m ? m.values.clientName : "Unknown"}</span><span className="text-slate-400"> — {t.title}</span></div>
                  <span className="text-red-600 font-medium shrink-0">{fmt(t.dueDate)}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-2">
          <AlertTriangle size={16} className="text-amber-500" /><h2 className="font-semibold text-slate-800">Cases Needing Attention</h2>
          <span className="text-xs text-slate-400 ml-auto">no activity in 30+ days</span>
        </div>
        {needsAttention.length === 0 ? <div className="p-8 text-center text-sm text-slate-400">Every active matter has recent activity.</div> : (
          <div className="divide-y divide-slate-50">
            {needsAttention.map(({ id, m, days, anchor }) => (
              <button key={id} onClick={() => goToMatter(id)} className="w-full text-left px-6 py-3.5 flex items-center gap-4 hover:bg-slate-50/60">
                <div className="min-w-0 flex-1"><div className="text-sm font-medium text-slate-800 truncate">{m.values.clientName}</div><div className="text-[11px] text-slate-400">{m.values.caseNumber || "no case #"}</div></div>
                <div className="text-xs text-right shrink-0">
                  <div className={`font-medium ${days === null || days > 60 ? "text-red-600" : "text-amber-600"}`}>{days === null ? "No activity logged" : `${days} days quiet`}</div>
                  <div className="text-slate-400">since {fmt(anchor)}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-2">
          <AlertTriangle size={16} className="text-slate-500" /><h2 className="font-semibold text-slate-800">Trial Countdown</h2>
        </div>
        {trialCountdown[30].length + trialCountdown[60].length + trialCountdown[90].length + trialCountdown[120].length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">No trial dates within 120 days.</div>
        ) : (
          <div className="grid grid-cols-4 divide-x divide-slate-100">
            {[{ key: 30, label: "Within 30", color: "text-red-600", bg: "bg-red-50", border: "border-red-200" },
              { key: 60, label: "31–60", color: "text-amber-600", bg: "bg-amber-50", border: "border-amber-200" },
              { key: 90, label: "61–90", color: "text-yellow-700", bg: "bg-yellow-50", border: "border-yellow-200" },
              { key: 120, label: "91–120", color: "text-slate-600", bg: "bg-slate-50", border: "border-slate-200" }].map((tier) => (
              <div key={tier.key} className="p-4">
                <div className={`text-xs font-semibold uppercase tracking-wide mb-3 ${tier.color}`}>{tier.label} Days</div>
                {trialCountdown[tier.key].length === 0 ? <p className="text-xs text-slate-300">None</p> : (
                  <div className="space-y-2">
                    {trialCountdown[tier.key].map(({ id, m, days }) => (
                      <button key={id} onClick={() => goToMatter(id)} className={`w-full text-left rounded-lg border px-2.5 py-2 ${tier.bg} ${tier.border} hover:opacity-80`}>
                        <div className="text-sm font-medium text-slate-800 truncate">{m.values.clientName}</div>
                        <div className="text-[11px] text-slate-500">{fmt(m.values.trialDate)} · {days}d</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-2"><Clock size={16} className="text-slate-500" /><h2 className="font-semibold text-slate-800">Upcoming Deadlines (90 days)</h2></div>
        {upcomingDeadlines.length === 0 ? <div className="p-8 text-center text-sm text-slate-400">Nothing on the horizon.</div> : (
          <div className="divide-y divide-slate-50">
            {upcomingDeadlines.slice(0, 12).map((d, i) => (
              <button key={i} onClick={() => goToMatter(d.id)} className="w-full text-left px-6 py-3 flex items-center justify-between text-sm hover:bg-slate-50">
                <div><span className="font-medium text-slate-800">{d.name}</span><span className="text-slate-400"> — {d.label}</span></div>
                <span className="text-slate-500">{fmt(d.date)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {notifOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50" onClick={() => setNotifOpen(false)}>
          <div className="bg-white rounded-xl max-w-lg w-full p-6 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1"><h3 className="font-semibold text-slate-800">Pending Notifications</h3><button onClick={() => setNotifOpen(false)}><X size={16} className="text-slate-400" /></button></div>
            <p className="text-xs text-slate-400 mb-4">Copy one and paste it in chat to have Claude send it — nothing goes out automatically.</p>
            {Object.keys(queue).length === 0 ? <p className="text-sm text-slate-400 text-center py-6">Nothing pending.</p> : (
              <div className="space-y-3">
                {Object.values(queue).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((n) => (
                  <div key={n.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-center justify-between mb-1"><span className="text-xs font-semibold text-slate-700">{n.recipientName}</span><span className="text-[10px] text-slate-400">{n.recipientEmail || "no email on file"}</span></div>
                    <div className="text-sm font-medium text-slate-800">{n.subject}</div>
                    <div className="text-xs text-slate-500 whitespace-pre-line mt-1">{n.body}</div>
                    <div className="flex items-center gap-3 mt-2">
                      <button onClick={() => copyText(`To: ${n.recipientEmail || n.recipientName}\nSubject: ${n.subject}\n\n${n.body}`, () => { setCopiedId(n.id); setTimeout(() => setCopiedId(null), 1500); })} className="flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-slate-900">
                        {copiedId === n.id ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
                      </button>
                      <button onClick={() => dismissNotification(n.id)} className="text-[11px] text-slate-400 hover:text-red-500">Dismiss</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {briefOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50 print:bg-white print:p-0" onClick={() => setBriefOpen(false)}>
          <div className="bg-white rounded-xl max-w-2xl w-full p-8 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1 print:hidden">
              <h3 className="font-semibold text-slate-800 text-lg">Today's Brief</h3>
              <div className="flex items-center gap-2">
                <button onClick={() => window.print()} className="flex items-center gap-1.5 text-xs border border-slate-300 rounded-lg px-2.5 py-1.5"><Printer size={13} /> Print</button>
                <button onClick={() => setBriefOpen(false)}><X size={18} className="text-slate-400" /></button>
              </div>
            </div>
            <p className="text-xs text-slate-400 mb-6">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</p>
            {Object.entries(byAttorney).map(([attorney, list]) => (
              <div key={attorney} className="mb-6">
                <h4 className="font-semibold text-slate-800 mb-2">{attorney}</h4>
                <ul className="text-sm space-y-1">
                  {list.filter(([id]) => needsAttention.some((n) => n.id === id)).map(([id, m]) => <li key={id} className="text-amber-700">⚠ {m.values.clientName} — no activity, needs a check-in</li>)}
                  {list.filter(([id]) => needsAttention.some((n) => n.id === id)).length === 0 && <li className="text-slate-400">No stale matters.</li>}
                </ul>
              </div>
            ))}
            <div className="border-t border-slate-100 pt-4 mt-4">
              <h4 className="font-semibold text-slate-800 mb-2">Shared — Upcoming Deadlines</h4>
              {upcomingDeadlines.length === 0 ? <p className="text-sm text-slate-400">Nothing in the next 90 days.</p> : (
                <ul className="text-sm space-y-1">{upcomingDeadlines.slice(0, 10).map((d, i) => <li key={i} className="flex justify-between"><span>{d.name} — {d.label}</span><span className="text-slate-500">{fmt(d.date)}</span></li>)}</ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SnapshotCard({ icon, label, value, accent }) {
  return (
    <div className={`bg-white rounded-xl border shadow-sm p-5 ${accent ? "border-amber-200" : "border-slate-200"}`}>
      <div className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-wide mb-2 ${accent ? "text-amber-600" : "text-slate-400"}`}>{icon} {label}</div>
      <div className="text-3xl font-bold text-slate-900">{value}</div>
    </div>
  );
}

if (typeof document !== "undefined" && !document.getElementById("cms-shared-style")) {
  const styleTag = document.createElement("style");
  styleTag.id = "cms-shared-style";
  styleTag.innerHTML = ".input { width: 100%; border: 1px solid #e2e8f0; border-radius: 0.5rem; padding: 0.5rem 0.75rem; font-size: 0.875rem; outline: none; background: white; } .input:focus { border-color: #0f172a; }";
  document.head.appendChild(styleTag);
}
