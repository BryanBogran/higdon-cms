# Roadmap — Higdon CMS as a Filevine clone

Supersedes the original port plan. That plan targeted Cases + Tasks + Dashboard on a real
database. The target is now a **Filevine clone**: same information architecture, same
vocabulary, same section set, so staff move over without retraining.

Phases 0 and 1 are complete. See [DECISIONS.md](DECISIONS.md) for why each call was made and
[REFERENCE_FILEVINE_AND_RLF.md](REFERENCE_FILEVINE_AND_RLF.md) for what the two reference
systems contribute.

---

## The scope problem, stated plainly

Filevine is a mature commercial platform. A faithful clone of all fourteen configured
sections, built section by section, is roughly **400–550 hours** — 10 to 21 months at 6–10
hours a week. That is the honest number for the naive approach, and it is worth saying before
any of it starts.

**But the naive approach is also the wrong architecture**, and fixing that is what makes the
project tractable.

### The multiplier: Filevine sections are mostly configuration, not code

Look at what a Filevine section actually is. Nearly all of them are the same three things in
different arrangements:

1. a set of **fields** (typed, labelled, grouped)
2. a **repeating collection** of rows (expenses, liens, providers, parties, calls)
3. **attachments and notes** hanging off either

Filevine is a platform — firms configure their own sections and fields; that's why two firms'
Filevine instances look different. So the correct move is to build **one generic section
engine** driven by a registry, exactly as `FIELDS` already drives the matter form today.

Then: **ten of the fourteen sections are a registry entry, not a sprint.** Only the ones with
real behavior get hand-built:

| Purpose-built | Why it can't be generic |
|---|---|
| **Activity** | feed semantics, composer, pinning, @mentions, kind filters |
| **Deadline Chain** | `CHAIN_RULES`, statutory math, override, holiday warnings |
| **Parties** | a real entity with FK relationships, not rows on a matter |
| **Expenses** | money math, totals, ties to settlement disbursement |
| Generic (registry-configured) | Med Chron Data · Call Log · Intake · DCO · Meds · Lost Wages · Liens · Case Summary · Insurance · Reminders |

That collapses the estimate to roughly **220–300 hours**, or 6–12 months at the stated pace.
Still a long build. Not a two-month one, and nobody should be told otherwise.

### Every section exists in the rail from day one

This is the part that makes the clone *feel* like a clone early. All fourteen sections appear
in the left rail from the moment the shell lands. A section nobody has purpose-built yet
still works — generic fields, a row collection, notes, attachments. Nothing reads as
"missing," and depth gets added where actual use justifies it.

### What the spreadsheet says about where depth is actually needed

`ORIG_CASE_DISCO-DEPO.xlsx` is evidence, not a guess. Fourteen sheets: Active, Settled,
Closed by year, Default Judgment, and **RS Case Exp**. The tracked columns are the litigation
checklist and the dates.

There is **no** med-chron sheet, no lost-wages sheet, no liens sheet. So the firm's real daily
tracking is: the matter list, the litigation checklist, dates and deadlines, and expenses.
That is where depth goes first. Med Chron, Meds, and Lost Wages exist in the rail and stay
generic until someone asks — and the profiling session in Phase 3 is where to confirm that
with the paralegal rather than assuming it.

---

## Phases

Effort unit: one evening ≈ 2–2.5 focused hours.

### ✅ Phase 0 — Repo and secrets hygiene · done
`/imports/` gitignored and verified. Domain rules transcribed. Decisions recorded.

### ✅ Phase 1 — Next.js scaffold, prototype renders unchanged · done
Next 16 / React 19 / Tailwind 4. Acceptance test passed: Served → Answer Due, Sep 21 2026,
Rule 99 note verbatim, survives reload.

### Phase 2 — Domain logic and the date rewrite · 4–5 evenings

Unchanged from the original plan, and still the highest-consequence work in the project.
Extract `fields.ts`, `chain.ts`, `dashboard.ts`; **rewrite** `dates.ts` rather than porting it.

Two amendments from the reference study:

- **`todayInFirmTz()`** becomes
  `new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })`. `en-CA` formats
  as `YYYY-MM-DD` and `timeZone` pins it to Central. Simpler than the hand-rolled helper.
  Date *arithmetic* still uses integer math via `Date.UTC` — RLF's `T12:00:00` noon anchor is
  better than the prototype's midnight but still timezone-dependent.
- **Add `checkBadDate(dateStr)`** now, alongside the chain rules: a federal holiday table
  (fixed dates plus nth-weekday for MLK, Presidents', Memorial, Labor, Columbus,
  Thanksgiving) returning `'Saturday' | 'Sunday' | holidayName | null`. **It warns; it never
  moves the date.** This is the answer to the Tex. R. Civ. P. 4 rollover gap — surface it to a
  human with a "move to next business day" button rather than adjusting silently.

### Phase 3 — Profile the real spreadsheet · 2–3 evenings

Unchanged. Read the xlsx directly with SheetJS and `cellDates: true`; emit distinct raw date
strings with counts; freeze as golden-file fixtures. Local only, no database, no cloud.

Added agenda item for the paralegal session: **walk the fourteen Filevine sections and mark
which ones they actually open.** That decides where depth goes and is the cheapest scope
control available.

### Phase 4 — The Filevine shell · 6–8 evenings

**Done when** the URL `/matters/{id}/activity` loads, the section rail navigates, the back
button works, and Dashboard/Cases/Tasks have re-homed into the new IA.

- Global rail: **Tasks · Feed · Project Hub · Documents** + global search
- **`/` routes to Tasks, not a dashboard.** Confirmed by observation — Filevine has no
  dashboard home. The Dashboard panels stay reachable but are not the front door; what staff
  need on opening is "what do I owe today," not "how is the practice doing."
- **The left rail is a slot the active view fills**, not a fixed component: due-date buckets
  on Tasks (All Due Dates · On or Before Today · Due Today · Next 7 Days · Next 30 Days, with
  an item count), the section list on a matter.
- **Filter chips as a first-class control** — individually removable, plus separate Clear and
  Reset actions. Makes the active query visible and reversible.
- Matter shell: header (`Last, First YY-NNN`, client name, click-to-call phone,
  click-to-email, project-type selector) + section rail + content area
- `lib/sections/registry.ts` — `{ key, label, icon, order, enabled, component }`, all
  fourteen present from day one
- App Router pages, real URLs, deep-linkable

**This lands before the mutation refactor deliberately.** Restructuring the shell touches
every call site; doing it after the intent refactor means touching them twice.

The prototype's three panels are three screens of the app, not the app. Dashboard and Cases
become Project Hub; Tasks stays Tasks.

### Phase 5 — The generic section engine · 5–7 evenings

**Done when** a new section is a registry entry plus a field list, with no new components.

The multiplier. One renderer handling: a typed field group (reusing the `FIELDS` machinery),
a repeating row collection with add/edit/delete, attachments, and section notes. Ten of the
fourteen sections are then configuration.

### Phase 6 — Per-record mutation API, still on localStorage · 3–4 evenings

Unchanged in intent, now covering the section engine's writes too. Intents, not collections.
`grep` for `localStorage` should hit exactly one file when this is done.

Cut the dead notification-queue UI here as planned — but note it is **rebuilt for real** in
Phase 13, because Reminders is a Filevine section and therefore in scope.

### Phase 7 — Schema · 6–8 evenings

The original hybrid schema, plus what the clone requires:

- `matter` — now with **client phone, client email, case/project type**. The prototype has
  none of these and Filevine shows all three in the header.
- `matter_checklist_item` — PK `(matter_id, field_key)`, `occurred_on`
- **`activity` — one table replacing both `task` and the feed.** A Filevine task *is* a note
  with an assignee and a due date: the same card carries body text, @mentions, attachments,
  assignee, due date, completion, pin, and a reply count. So `kind`
  (`note | task | call | text | email | fax | system`), `pinned`, `body`, `author_user_id`,
  `parent_id` for threaded replies, and nullable `assigned_to_user_id` / `due_date` /
  `completed`. Chain idempotency unchanged — partial unique
  `(matter_id, rule_key) WHERE source='auto'`. Filevine's "Assign as Task" on a note becomes
  an UPDATE rather than an INSERT, which is why it works in place. Append-only trigger guards
  `kind='system'` rows only; human rows edit normally.
- **`attachment`** — keyed to `activity`, not to `matter`. Files hang off the entry that
  introduced them, as the task cards show.
- `app_user` gains **`handle`** (unique, for `@mention`) alongside `display_name`, plus an
  `is_role_account` flag — mentions render `@jscholl` and `@hlaccounting` while assignment
  shows `Alex TurnerJr.`
- **`contact` / `matter_party`** — the Parties entity, with `role` on the join
- **`section_record`** — the generic engine's row storage, `(matter_id, section_key, ordinal,
  data jsonb)`. JSONB is correct *here*, unlike on `matter`: these rows have no statutory
  dates and no money that drives a decision. Any field that grows teeth gets promoted to a
  typed column in its own table later.
- `audit_event`, `matter_field_issue`, `case_number_counter`, `app_user`, `user_alias`,
  `import_batch`, `import_row`, NextAuth tables

### Phase 8 — API routes, server-side chain, validation · 5–7 evenings
### Phase 9 — Swap to HTTP: write queue and save indicator · 4–5 evenings
### Phase 10 — Auth · 2–3 evenings

Unchanged from the original plan. Auth remains the gate: no real client data in a hosted
database before it lands.

### Phase 11 — Activity feed, for real · 8–12 evenings

> Because `activity` is one table, this phase delivers the **matter Activity section, the
> global Tasks landing screen, and the firm-wide Feed** from one component family. That is a
> large part of why the clone is tractable.

**Done when** a paralegal can post a note, pin it, @mention someone, filter to Phone Calls,
and promote a note to a task without leaving the feed.

Reproducing Filevine's observed mechanics: chronological stream; **Quick Filters** (All,
Notes, Emails, Faxes, Phone Calls, Texts, Tasks, Reminders); a **Pinned** group with a count;
`@mention` resolving to people *and* role accounts; inline composer; per-entry overdue badge,
assignee, due date, and Complete button *inside the entry*; **"Assign as Task" on a note**,
promoting in place.

Plus **Feed** as the firm-wide version of the same component, and RLF's **Quick Note** —
voice dictation and drag-drop attachments.

### Phase 12 — Sections, in dependency order · 12–18 evenings

**Parties first** — contacts, roles, click-to-call, and the client contact info the prototype
can't store. Most other sections lean on it.

Then **Expenses** (money math, totals; `RS Case Exp` is a real sheet), **Deadline Chain** as a
proper section view over the auto tasks with holiday warnings, and **Case Summary**. The
remaining ten stay generic until use argues otherwise.

### Phase 13 — Reminders and the cron engine · 5–7 evenings

The producer the prototype never had, built on RLF's proven shape:

- reminders embedded per deadline as `{ daysBefore, date, sent }`; offsets `120/90/60/30`
- a scheduled route finds `date === today && sent === false`, sends, flips `sent`. **That flag
  is the idempotency key.**
- a weekday **morning brief** that sends *even when empty*, so silence is unambiguous
- **still review-gated for anything statutory**, per the original no-autosend constraint

Cap and alert on scheduled-job cost. RLF's setup guide warns that exhausting Netlify credits
pauses the *entire site*; the hosting differs but the lesson transfers.

### Phase 14 — Importer · 8–12 evenings

### Phase 15 — Daily-use hardening · 5–7 evenings

Task edit, soft delete/archive, centralized `values` factory, activity feed on the matter, and
a shared `dateBadge(days)` helper that returns `unknown` (grey, warned) for `null` — never
green.

Added from observation: **task pagination and bulk complete/delete.** Not polish — the Filevine
Tasks screen showed **117 open items already filtered to one person**, overdue by months to
over a year. Nobody clears that one click at a time, and a permanently-red overdue panel gets
ignored exactly as the dead notification bell would have. Overdue is the normal state here:
calm sortable badges, narrow default filters, no alarm UI.
### Phase 16 — Deploy, protect, back up, cut over · 3–4 evenings + a cutover day

Unchanged. The importer is retired after cutover, enforced in code.

### Phase 17+ — AI, in this order

1. **PNC intake** — paste an email, form, voicemail note, or recording; extract facts, flag
   SOL concerns, **check for duplicate callers**, suggest tasks, create matter + contact +
   tasks in one click; draft a reason-based decline as a Gmail *draft*. Replaces
   `pi-intake.jsx`.
2. **Document extraction** — server-side, key in env, structured tool use rather than
   JSON-in-a-fence, `type: 'document'` for PDFs. **The model extracts the anchor date and the
   rule text it found; code does the arithmetic.** RLF states this principle and then breaks
   it in `extract-notice.js`; hold the line.
3. **Case status reports** — per matter or all-active, labelled sections, Word/PDF export,
   "Request Changes" to revise in place.
4. **Gmail sync and email triage.**

Target the current model generation — Sonnet 5 for extraction and drafting, Haiku 4.5 where
latency and cost dominate. RLF's call sites are a generation behind.

---

## Filevine access ends 2026-08-28

Confirmed with the firm: the licence lapses tomorrow, and the team is already exporting case
records. Documents live on Google Drive, so the client files themselves were never at risk.

The extraction checklist is [FILEVINE_LAST_DAY_CHECKLIST.md](FILEVINE_LAST_DAY_CHECKLIST.md).
Its premise: an ops team exporting *records* will skip *configuration and layout*, which are
equally unrecoverable. The Project Template export is the highest-value single file, because
it turns ten of the fourteen sections from guesswork into configuration.

**What this changes about the plan:**

- **Phases 2 and 3 are unaffected** — the date rewrite and the spreadsheet profiling depend on
  nothing from Filevine. Work continues without interruption.
- **Phase 4 (shell) and Phase 5 (section engine) now depend on whatever came out today.** If
  the template export succeeded, the section registry is transcription rather than design. If
  it didn't, the registry gets built from the one Activity screenshot plus the spreadsheet's
  column names, and every section is a best guess until staff correct it in use.
- **A new input arrives that the plan didn't assume: the Filevine Activity history.** If it
  exported, the Phase 11 feed has real historical content to import and display, and the
  Phase 7 `activity` table needs an import path alongside the matter importer. That is a
  genuine addition to scope — and worth it, since for many matters the notes are the only
  written record of what happened and why.
- **The verification baseline is now load-bearing.** Record counts captured today are the only
  way to prove the import was complete; the acceptance tests in the importer phase should
  reconcile against them, not just against the spreadsheet.

Once the dust settles, the first task is an inventory: what actually came out, in what format,
with what fidelity. That determines whether the section work is configuration or archaeology.

Most valuable, in order: **Parties · Expenses · Deadline Chain · Liens · Med Chron Data**,
plus **Project Hub** (the matter list) and one **Documents** view.
