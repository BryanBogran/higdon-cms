# Higdon Lawyers — Case Management System

Replacement for Filevine, built from: (1) the firm's CMS Capabilities Overview
letter, (2) the ORIG_CASE_DISCO-DEPO.xlsx spreadsheet (real case data, 14
sheets: Active, Settled, Closed by year, Default Judgment, RS Case Exp), and
(3) screenshots of the firm's actual Filevine project pages.

## Current state: working browser prototype, not production

Everything in `prototype/` is a React component built to run as a Claude.ai
"artifact" — it uses `window.storage` (a Claude-only key/value API) for
persistence instead of a real backend. **That call needs to be swapped out
for real API calls to a database before this goes anywhere near production.**
Everything else — schema, business logic, UI — is meant to carry over as-is.

- `prototype/higdon-cms.jsx` — the main app. Top nav (Dashboard / Cases /
  Tasks) + global search that jumps to a case's full record. This is the
  current source of truth; it supersedes earlier standalone versions of
  Dashboard, Tasks, and Case Records that were built incrementally during
  development and then merged in here.
- `prototype/mail-intake.jsx` — AI mail processing (upload/paste a document,
  Claude classifies it, matches it to a matter, extracts dates for review,
  and files it). Currently calls `api.anthropic.com` directly from the
  browser — fine for a prototype, should go through your own backend in
  production so the API key isn't exposed client-side.
- `prototype/pi-intake.jsx` — PI plaintiff intake form with SOL calculation.
  Not yet wired into the main nav.

## Data model

Matter record fields (see `FIELDS` array in `higdon-cms.jsx`) mirror the
spreadsheet's real columns, grouped into three sections:

- **Case Info**: clientName, caseNumber, attorney, status, openDate, doa,
  sol, opposingCounsel, trialDate, dco, insurance, commercial
  (Commercial / Personal Lines / Self-Insured-Government / Unknown),
  referral, crossRefCase
- **Litigation Checklist**: suitFiled, served, answerFiled,
  plDiscoverySent, plDiscoveryAnswered, defDiscoveryReceived,
  defDiscoveryAnswered, recordsOrdered, affidavitsFiled, plDepo, defDepo,
  mediation, treatmentDone — each stored as `{ done, docUrl, note, date }`.
  Marking one "done" stamps a trigger date and prompts for a document link
  (Dropbox URL). Once both are set, clicking it again opens the document
  directly instead of toggling.

CSV import (`onFile`/`confirmImport` in the Cases panel) maps spreadsheet
column headers to these field keys via longest-prefix matching (`HEADER_MAP`),
so it tolerates the initials/suffixes the real sheet has (e.g. "DCO-MA",
"Check Status-DD, ML"). Shows a mapping review screen before writing anything.

## Case numbering

Format `YY-NNN` — 2-digit year the matter was opened, 3-digit sequence,
**resets to 1 every year** (confirmed with the client; matches real usage,
e.g. `26-042` = 42nd case opened in 2026). See `nextCaseNumber` logic
wherever new matters are created from Mail Intake.

## Deadline Chain (`CHAIN_RULES` in `higdon-cms.jsx`)

Auto-generates tasks off matter data. Every rule is named/sourced — never an
invented date:

- `served` → Answer Due: Tex. R. Civ. P. 99, Monday on/after 20 days from
  service
- `plDiscoverySent` → Defendant's Discovery Response Due: Tex. R. Civ. P.
  196/197, 30 days
- `defDiscoveryReceived` → Plaintiff's Discovery Response Due: same rule
- `sol`, `trialDate`, `dco` → pulled straight from the matter record
- `recordsOrdered` → internal 30-day follow-up reminder
- `plDepo` → internal 14-day transcript-review reminder

Tasks regenerate whenever matter data changes (`generateChainTasks`), keyed
by `auto:{matterId}:{ruleKey}` so they update in place rather than
duplicating. A `manualOverride` flag lets a human override a computed date
without losing the auto-calculation if they later want it back.

All statutory dates are flagged "confirm with attorney" — this system should
never be the sole source of truth for a real deadline.

## Notifications & calendar sync — review-before-send by design

There is intentionally **no autosend**. A `notification-queue` entry is
generated when: a task is created, a task goes overdue (once/day), or a
matter crosses a trial-countdown tier (30/60/90 days, one-time per tier via
`trial-tier-fired`). The UI shows the queue and lets the user copy the
content — actually sending email or creating calendar events happens only
when a human confirms it, because neither browser storage nor a stateless
chat session should be trusted to autonomously message people or write to
a calendar. **In production this is the piece that becomes real**: a proper
backend with a scheduler (cron/queue worker) that actually calls the Gmail
API and Google Calendar API, likely still gated by a review step in the UI
for anything statutory.

The `team-directory` store (`{name: email}`) resolves task assignees to
real addresses for this. It's currently maintained by hand in the Tasks
panel's "Team" modal.

## What still needs to be built for a real production app

1. **Backend + database.** Replace every `window.storage.get/set` call with
   real API calls (Postgres/similar). The shapes are already
   JSON-serializable objects keyed by UUID, so this is a fairly direct port.
2. **Auth** — currently zero. Needs real user accounts/roles (attorney,
   paralegal, admin) before this touches real client data.
3. **Real Google Calendar + Gmail write access**, gated by the review UI
   already in place, run from a proper backend/service account rather than
   the end user's personal OAuth in a browser tab.
4. **Document storage** — right now a "document" is just a pasted Dropbox
   URL. Decide whether that stays the model (simplest, keeps files in
   Dropbox as the letter originally proposed) or whether documents should
   be uploaded directly into the CMS.
5. **Sections not yet built**: Settlement Calculator, Expenses, Liens,
   Meds/Med Chron, Pleadings, Parties/Contacts, Related Cases — all visible
   in the Filevine screenshots but not yet ported.
6. **Mail Intake / PI Intake** aren't in the main nav yet — decide whether
   they become tabs in `higdon-cms.jsx` or stay separate intake-only tools.

## Source documents

The original capabilities letter and the DISCO-DEPO spreadsheet were used to
derive the schema and rules above but aren't included in this export —
they contain real client data. Re-upload them in Claude Code if further
schema work references them.
