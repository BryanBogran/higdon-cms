import React, { useState, useEffect, useRef } from "react";
import {
  Upload, FileText, Calendar, Check, X, AlertCircle, Loader2,
  ChevronRight, Search, Plus, Sparkles, Link2,
} from "lucide-react";

// ---- Case numbering: YY-NNN, 3-digit sequence, resets each year ----
function nextCaseNumber(matters, year) {
  const yy = String(year).slice(-2);
  const used = Object.values(matters)
    .map((m) => m.values.caseNumber || "")
    .filter((c) => c.startsWith(yy + "-"))
    .map((c) => parseInt(c.split("-")[1], 10))
    .filter((n) => !isNaN(n));
  const next = used.length ? Math.max(...used) + 1 : 1;
  return `${yy}-${String(next).padStart(3, "0")}`;
}

const DOC_TYPE_TO_TASK = {
  "Discovery Request": "plDiscoverySent",
  "Discovery Response": "plDiscoveryAnswered",
  "Defendant's Discovery": "defDiscoveryReceived",
  "Citation / Proof of Service": "served",
  "Petition / Suit": "suitFiled",
  "Answer": "answerFiled",
  "Deposition Transcript": null, // ask plaintiff vs defendant
  "Medical Records": "recordsOrdered",
  "Affidavit": "affidavitsFiled",
  "Mediation Notice": "mediation",
  "Court Order / Notice": null,
  "Correspondence": null,
  "Other": null,
};

function emptyValuesShape() {
  // mirrors case-record-system.jsx field keys for the checklist items we might touch
  return {};
}

async function callClaude(promptParts) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{ role: "user", content: promptParts }],
    }),
  });
  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

export default function MailIntake() {
  const [matters, setMatters] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [pastedText, setPastedText] = useState("");
  const [imageData, setImageData] = useState(null); // {base64, mediaType, name}
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null); // AI output, editable before filing
  const [filed, setFiled] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get("case-records", false);
        if (res && res.value) setMatters(JSON.parse(res.value));
      } catch (e) {}
      setLoaded(true);
    })();
  }, []);

  async function persistMatters(next) {
    setMatters(next);
    try {
      await window.storage.set("case-records", JSON.stringify(next), false);
    } catch (e) {}
  }

  function onFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(",")[1];
      setImageData({ base64, mediaType: file.type || "image/png", name: file.name });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  async function analyze() {
    setError("");
    setResult(null);
    setFiled(false);
    if (!pastedText.trim() && !imageData) {
      setError("Paste the mail's text or upload a scan/screenshot first.");
      return;
    }
    setAnalyzing(true);
    try {
      const matterList = Object.entries(matters).map(([id, m]) => ({
        id,
        clientName: m.values.clientName,
        caseNumber: m.values.caseNumber,
      }));

      const instructions = `You are reviewing a piece of incoming mail for a Texas plaintiff personal injury/civil litigation firm. Identify:
1. "documentType" — one of: ${Object.keys(DOC_TYPE_TO_TASK).join(", ")}
2. "label" — a short filing label (e.g. "Defendant's Answer to Interrogatories")
3. "matterMatch" — best match against this list of existing matters by client name or case number: ${JSON.stringify(matterList)}. Return {id, clientName, caseNumber, confidence: "high"|"medium"|"low"|"none"}. If no match, confidence "none" and id null.
4. "dates" — array of {label, date (YYYY-MM-DD), reasoning} for every deadline, hearing, or date-driven event stated or directly implied in the document (e.g. a served discovery request implies a 30-day response deadline). Only extract dates actually present or a plain, stated response-window rule — never invent a date.
5. "summary" — one sentence on what this document is.

Respond with ONLY raw JSON, no markdown fences, matching:
{"documentType":"","label":"","matterMatch":{"id":null,"clientName":"","caseNumber":"","confidence":"none"},"dates":[{"label":"","date":"","reasoning":""}],"summary":""}`;

      const content = [];
      if (imageData) {
        content.push({ type: "image", source: { type: "base64", media_type: imageData.mediaType, data: imageData.base64 } });
      }
      content.push({ type: "text", text: instructions + (pastedText.trim() ? `\n\nDocument text:\n${pastedText}` : "") });

      const parsed = await callClaude(content);
      setResult(parsed);
    } catch (e) {
      setError("Couldn't analyze that document. Try pasting the text directly instead of an image, or check the content and try again.");
    } finally {
      setAnalyzing(false);
    }
  }

  function updateResult(patch) {
    setResult((r) => ({ ...r, ...patch }));
  }
  function updateDate(i, patch) {
    setResult((r) => {
      const dates = [...r.dates];
      dates[i] = { ...dates[i], ...patch };
      return { ...r, dates };
    });
  }
  function removeDate(i) {
    setResult((r) => ({ ...r, dates: r.dates.filter((_, idx) => idx !== i) }));
  }

  function fileDocument() {
    const next = { ...matters };
    let matterId = result.matterMatch.id;

    if (!matterId) {
      // create a new matter with a freshly generated case number
      const year = new Date().getFullYear();
      const caseNumber = nextCaseNumber(matters, year);
      matterId = crypto.randomUUID();
      next[matterId] = {
        values: {
          clientName: result.matterMatch.clientName || result.label,
          caseNumber,
          attorney: "", status: "Open",
          openDate: new Date().toISOString().slice(0, 10),
          doa: "", sol: "", opposingCounsel: "",
          trialDate: "", dco: "", insurance: "", commercial: "", referral: "", crossRefCase: "",
          suitFiled: { done: false, docUrl: "", note: "" }, served: { done: false, docUrl: "", note: "" },
          answerFiled: { done: false, docUrl: "", note: "" }, plDiscoverySent: { done: false, docUrl: "", note: "" },
          plDiscoveryAnswered: { done: false, docUrl: "", note: "" }, defDiscoveryReceived: { done: false, docUrl: "", note: "" },
          defDiscoveryAnswered: { done: false, docUrl: "", note: "" }, recordsOrdered: { done: false, docUrl: "", note: "" },
          affidavitsFiled: { done: false, docUrl: "", note: "" }, plDepo: { done: false, docUrl: "", note: "" },
          defDepo: { done: false, docUrl: "", note: "" }, mediation: { done: false, docUrl: "", note: "" },
          treatmentDone: { done: false, docUrl: "", note: "" },
          settlementAmount: "", settlementDate: "", demands: "", howSettled: "", checkStatus: "",
          mailLog: [],
        },
      };
    }

    const m = next[matterId];
    if (!m.values.mailLog) m.values.mailLog = [];
    m.values.mailLog = [
      ...m.values.mailLog,
      { label: result.label, documentType: result.documentType, receivedDate: new Date().toISOString().slice(0, 10), dates: result.dates },
    ];
    m.values.lastActivityAt = new Date().toISOString();

    const taskKey = DOC_TYPE_TO_TASK[result.documentType];
    if (taskKey && m.values[taskKey]) {
      m.values[taskKey] = { ...m.values[taskKey], done: true, note: result.label };
    }

    persistMatters(next);
    setFiled(true);
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900" style={{ fontFamily: "'IBM Plex Sans','Inter',system-ui,sans-serif" }}>
      <div className="bg-slate-900 text-white">
        <div className="max-w-4xl mx-auto px-6 py-5">
          <div className="text-xs uppercase tracking-widest text-slate-400 font-semibold">Higdon Lawyers</div>
          <h1 className="text-xl font-bold mt-0.5">Mail Intake & AI Filing</h1>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        {/* Input */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <div className="flex items-center gap-2 mb-4">
            <FileText size={18} className="text-slate-500" />
            <h2 className="font-semibold text-slate-800">Incoming Mail</h2>
          </div>
          <textarea
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            placeholder="Paste the letter, notice, or filing text here…"
            rows={6}
            className="input resize-none mb-3"
          />
          <div className="flex items-center gap-3">
            <input ref={fileRef} type="file" accept="image/*,.pdf" className="hidden" onChange={onFile} />
            <button onClick={() => fileRef.current.click()} className="flex items-center gap-1.5 text-sm border border-slate-300 rounded-lg px-3 py-1.5 hover:border-slate-500">
              <Upload size={14} /> {imageData ? imageData.name : "Upload scan / screenshot"}
            </button>
            {imageData && (
              <button onClick={() => setImageData(null)} className="text-slate-300 hover:text-red-500">
                <X size={15} />
              </button>
            )}
            <div className="flex-1" />
            <button
              onClick={analyze}
              disabled={analyzing}
              className="flex items-center gap-1.5 bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
            >
              {analyzing ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
              {analyzing ? "Analyzing…" : "Analyze with AI"}
            </button>
          </div>
          {error && (
            <div className="mt-3 flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertCircle size={14} /> {error}
            </div>
          )}
        </div>

        {/* Review */}
        {result && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles size={16} className="text-slate-500" />
              <h2 className="font-semibold text-slate-800">Review before filing</h2>
            </div>
            <p className="text-xs text-slate-400 mb-4">Nothing is saved or calendared until you confirm below.</p>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Document Type</label>
                <select className="input" value={result.documentType} onChange={(e) => updateResult({ documentType: e.target.value })}>
                  {Object.keys(DOC_TYPE_TO_TASK).map((t) => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Label</label>
                <input className="input" value={result.label} onChange={(e) => updateResult({ label: e.target.value })} />
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Files To</label>
              <select
                className="input"
                value={result.matterMatch.id || ""}
                onChange={(e) => {
                  const id = e.target.value;
                  const m = matters[id];
                  updateResult({ matterMatch: { id: id || null, clientName: m?.values.clientName || "", caseNumber: m?.values.caseNumber || "", confidence: id ? "manual" : "none" } });
                }}
              >
                <option value="">— New matter (will assign next case number) —</option>
                {Object.entries(matters).map(([id, m]) => (
                  <option key={id} value={id}>{m.values.clientName} ({m.values.caseNumber || "no #"})</option>
                ))}
              </select>
              {result.matterMatch.confidence !== "manual" && (
                <div className="text-[11px] text-slate-400 mt-1">
                  AI match confidence: <span className="font-medium">{result.matterMatch.confidence}</span>
                </div>
              )}
              {!result.matterMatch.id && (
                <div className="text-[11px] text-emerald-600 mt-1">
                  Will create a new matter and assign case number {nextCaseNumber(matters, new Date().getFullYear())}
                </div>
              )}
            </div>

            <div className="mb-2">
              <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <Calendar size={12} /> Dates to Calendar
              </label>
              {result.dates.length === 0 ? (
                <p className="text-xs text-slate-400">No dates found in this document.</p>
              ) : (
                <div className="space-y-2">
                  {result.dates.map((d, i) => (
                    <div key={i} className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-2">
                      <input className="input flex-1" value={d.label} onChange={(e) => updateDate(i, { label: e.target.value })} />
                      <input type="date" className="input w-40" value={d.date} onChange={(e) => updateDate(i, { date: e.target.value })} />
                      <button onClick={() => removeDate(i)} className="text-slate-300 hover:text-red-500 shrink-0"><X size={14} /></button>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-slate-400 mt-2">
                These stage as reminders on the matter. Confirm with Claude in chat to push them to the Higdon Lawyers Google Calendar.
              </p>
            </div>

            <button
              onClick={fileDocument}
              disabled={filed}
              className="w-full mt-4 bg-slate-900 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-slate-800 disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {filed ? <><Check size={15} /> Filed</> : "Confirm & File Document"}
            </button>
          </div>
        )}
      </div>

      <style>{`
        .input { width: 100%; border: 1px solid #e2e8f0; border-radius: 0.5rem; padding: 0.5rem 0.75rem; font-size: 0.875rem; outline: none; background: white; }
        .input:focus { border-color: #0f172a; }
      `}</style>
    </div>
  );
}
