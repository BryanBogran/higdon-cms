# Higdon Lawyers — Case Management System

In-house replacement for Filevine. Texas personal-injury and litigation practice.

**Status: backend built, awaiting a Supabase project.** The Filevine shell, the section
registry, tested date math, the Postgres schema, auth, and the Supabase data layer are all in
place. Follow [docs/SETUP.md](docs/SETUP.md) to point it at a real database — about 45 minutes.
Until then the app runs on browser storage.

- **▶ Start here — setup runbook: [docs/SETUP.md](docs/SETUP.md)**
- **Roadmap: [docs/ROADMAP.md](docs/ROADMAP.md)**
- **Next up — backend, database, login: [docs/BACKEND_PLAN.md](docs/BACKEND_PLAN.md)**
- Decisions and their reasoning: [docs/DECISIONS.md](docs/DECISIONS.md)
- Reference study of Filevine and the RLF CMS: [docs/REFERENCE_FILEVINE_AND_RLF.md](docs/REFERENCE_FILEVINE_AND_RLF.md)
- The original prototype README: [docs/ORIGINAL_PROTOTYPE_README.md](docs/ORIGINAL_PROTOTYPE_README.md)
- Reference prototype, untouched: [prototype/](prototype/)

**The target is a Filevine clone** — same information architecture, same vocabulary, same
section set, so staff move over without retraining. Filevine's own configured section list is
the spec: Activity, Med Chron Data, Call Log, Intake, DCO, Meds, Lost Wages, Liens, Case
Summary, Expenses, Parties, Insurance, Deadline Chain, Reminders.

The architecture that makes that tractable is a **generic section engine** driven by a
registry: most Filevine sections are a field group plus a repeating collection plus
attachments, so ten of the fourteen are configuration rather than code. All fourteen appear in
the rail from the moment the shell lands; depth gets added where real use justifies it. See
the roadmap for the honest effort estimate.

---

## ⚠️ Client data

`/imports/` is gitignored, as are `*.xlsx` and `*.xls`. The firm's
`ORIG_CASE_DISCO-DEPO.xlsx` contains real client data and must never be committed, never
enter a hosted database before auth exists, and never appear in a Vercel preview deployment
(previews are **public by default** — deployment protection goes on before the first push).

Dropbox share links stored as `doc_url` are bearer-token capability URLs to privileged
documents. They are never copied into the audit table, and never logged.

---

## Domain reference

Transcribed from the prototype. This section is the authoritative written record of rules
that exist nowhere else — particularly the case-numbering reset, which was confirmed with
the client and is not derivable from the code.

### Case numbering

Format **`YY-NNN`** — 2-digit year the matter was opened, 3-digit sequence, **resets to 1
every year.** Confirmed with the client and matching real usage: `26-042` is the 42nd case
opened in 2026.

Because the number is semantic, **gaps are wrong, not merely untidy** — which is why
allocation uses a counter row rather than a Postgres sequence (sequences don't roll back).
Existing history must seed the counter or the first new case collides.

Two edge cases that must fail loudly rather than silently: more than 999 cases in one year,
and normalizing `"26-42"` / `"26 - 042"` / `"26-042"` to the same value before the
uniqueness check.

### Matter fields — 33, in three sections

**Case Info (14)** — `clientName`, `caseNumber`, `attorney`, `status`, `openDate`, `doa`
(date of accident), `sol` (statute of limitations), `opposingCounsel`, `trialDate`, `dco`
(docket control order), `insurance`, `commercial`, `referral`, `crossRefCase`

- `status` ∈ `Open` | `Closed` | `Settled - Not Disbursed` | `Default Judgment`
- `commercial` ∈ `Commercial` | `Personal Lines` | `Self-Insured / Government` | `Unknown`

**Litigation Checklist (13)** — all of type `yesnoDoc`: `suitFiled`, `served`,
`answerFiled`, `plDiscoverySent`, `plDiscoveryAnswered`, `defDiscoveryReceived`,
`defDiscoveryAnswered`, `recordsOrdered`, `affidavitsFiled`, `plDepo`, `defDepo`,
`mediation`, `treatmentDone`

Each stores `{ done, docUrl, note, date }`. Marking one done stamps a trigger date and
prompts for a Dropbox URL; once both are set, clicking again opens the document instead of
toggling.

> **In the production schema, `date` is renamed `occurred_on`** — it is the date a legal
> event happened in the world, and must never be confused with `updated_at`, when a human
> typed it. See [DECISIONS.md](docs/DECISIONS.md).

**Financial (5)** — `settlementAmount`, `settlementDate`, `demands`, `howSettled`,
`checkStatus`

Two fields live in the record but are absent from the field registry, so they are invisible
to the generic form renderer *and* to import/export: `lastActivityAt` and `mailLog`.

### The deadline chain — 8 rules

Auto-generates tasks from matter data. **Every rule is named and sourced; never an invented
date.** Notes are reproduced verbatim because they are the malpractice guardrail:

| Trigger | Task | Note | Computation |
|---|---|---|---|
| `served` | Answer Due | *Tex. R. Civ. P. 99 — Monday next after 20 days from service. Confirm with attorney.* | Monday on/after service + 20d |
| `plDiscoverySent` | Defendant's Discovery Response Due | *Tex. R. Civ. P. 196/197 — 30 days. Confirm with attorney.* | + 30d |
| `defDiscoveryReceived` | Plaintiff's Discovery Response Due | *Tex. R. Civ. P. 196/197 — 30 days. Confirm with attorney.* | + 30d |
| `sol` | Statute of Limitations | *From matter record.* | passthrough |
| `trialDate` | Trial | *From matter record.* | passthrough |
| `dco` | Docket Control Order Deadline | *From matter record.* | passthrough |
| `recordsOrdered` | Follow Up on Medical Records | *Internal — 30 days after ordered.* | + 30d |
| `plDepo` | Send Deposition Transcript for Review | *Internal — 14 days after deposition.* | + 14d |

Tasks are keyed `auto:{matterId}:{ruleKey}` so regeneration updates in place rather than
duplicating. In SQL this becomes a partial unique index on `(matter_id, rule_key) WHERE
source = 'auto'`.

Semantics that must survive the port exactly:

- `dueDate` and `autoDueDate` are **separate**. `autoDueDate` always holds the computed
  value; `dueDate` diverges when `manualOverride` is set. That split is how "give me the
  auto date back" works.
- Regeneration preserves `completed`, `calendarSynced`, `assignedTo`, and `manualOverride`.
- An auto task whose trigger disappears is **deleted** — unless it is completed or manually
  overridden.
- `assignedTo` defaults to the matter's attorney, falling back to the literal string
  `"Unassigned"`.

**All statutory dates are flagged "confirm with attorney." This system must never be the
sole source of truth for a real deadline.**

Five of the eight rules gate on `X.done && X.date`, so a checklist item marked done with no
date produces **no deadline at all** — while the task list still looks populated. The
production schema indexes that gap (`WHERE done AND occurred_on IS NULL`) and surfaces it as
a review queue rather than fabricating a date.

### Notifications — review-before-send by design

There is **no autosend**, and that is deliberate: neither browser storage nor a stateless
chat session should be trusted to autonomously message people or write to a calendar.

In production this becomes a backend scheduler that actually calls the Gmail and Google
Calendar APIs — **still gated by a human review step for anything statutory.**

> Note: the prototype's notification queue has **no producer**. Nothing ever creates an
> entry; `trial-tier-fired` appears nowhere in the code. The bell renders, carries a badge,
> and can never ring. The dead UI is removed in Phase 6 and Reminders is built properly in
> Phase 13 — a bell that will never ring is worse than no bell, because staff see it empty
> and conclude they're covered.

### CSV / spreadsheet import

Column headers map to field keys by **longest-prefix** match, which is what tolerates the
real sheet's initials and suffixes — `"DCO-MA"`, `"Check Status-DD, ML"`. Headers are
normalized (trim, uppercase, collapse whitespace) before matching.

Worth preserving: for the 13 checklist fields, a cell that isn't yes/no has its **raw text
kept as the note** and surfaced in the UI as `imported note: "..."`. It is the only reason
`"answered 3/2 per MA"` isn't lost today. The production importer does the same for dates.

Known gaps in the prototype's mapping, addressed by the production importer:

- **No mapping exists for `openDate`**, so every imported row is stamped with today's date.
  All historical matters report as opened this week, corrupting both "Opened This Month" and
  every staleness calculation. Production derives the year from `caseNumber` and leaves it
  NULL otherwise — NULL is honest, `today()` is a lie that looks like data.
- `"ANSWER FILED"` and `"ANSWERED"` both map to `answerFiled`; likewise `"TREATMENT DONE?"`
  and `"STILL TREATING? YES/NO"`. Today the winner depends on object iteration order.
- Dates are stored raw and unnormalized, so `"3/1/24"` renders blank in a date input and
  NaNs through every comparison — silently vanishing from Trial Countdown rather than
  erroring.
- Re-importing the same file duplicates every matter (fresh UUID per row, no dedupe).

### Source documents

The capabilities letter and `ORIG_CASE_DISCO-DEPO.xlsx` (14 sheets: Active, Settled, Closed
by year, Default Judgment, RS Case Exp) were used to derive the schema and rules above.
They contain real client data and are not in this repo.

`RS Case Exp` is an expense ledger, not matters — explicitly **not** importable at Milestone
1. Importing it as matter rows would create dozens of phantom cases.
