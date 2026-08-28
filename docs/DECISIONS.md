# Architectural Decisions

Append-only. Newest last. Each entry: date, decision, reasoning, and what would change
the answer. Written because in six weeks the reasoning will be gone.

---

## 2026-08-27 · Stack: Next.js + Postgres + Drizzle on Neon, NextAuth

One codebase, one deploy. The prototype's JSX ports over nearly unchanged, and the
Anthropic API key lives server-side by default — which fixes Mail Intake's auth problem
for free rather than requiring a separate backend.

**Drizzle over Prisma.** This schema needs three partial unique indexes, ~12 CHECK
constraints, a generated stored column, six audit triggers, and an
`ON CONFLICT ... DO UPDATE` with a `CASE` expression in the SET clause. Prisma can express
none of those in `schema.prisma` — they'd live in hand-edited migration SQL, and the
generated client would have no knowledge of constraints it didn't create, so the schema and
the type layer drift by design.

**The non-negotiable is that the constraints exist, not which ORM.** What is *not*
acceptable is dropping the partial indexes and CHECKs because the ORM makes them awkward.

**Would change the answer:** discovering that Drizzle's migration story for triggers is
worse in practice than expected. Fallback is Prisma plus a disciplined `migrations/*.sql`
folder.

---

## 2026-08-27 · Get the prototype rendering unchanged before touching the database

This code has never run in a real bundler. Going straight to schema means simultaneously
debugging: Drizzle migrations, Neon connection pooling, NextAuth callbacks, Tailwind
arbitrary-value config, papaparse ESM interop, and a module-scope `document.createElement`
that has only ever executed inside Claude's artifact sandbox. Each is a 20-minute problem
alone and a lost weekend together.

Prove the build in isolation against a 15-line throwaway localStorage shim, then every
later change has a known-good baseline behind it.

**Do not improve the shim.** It is deleted in Phase 7. See the next entry for why letting
it become an abstraction is the trap.

---

## 2026-08-27 · Do NOT build a storage-shaped adapter and swap its implementation

The most important decision in the port.

`storage.set("case-records", <entire collection>)` makes the full-blob write **structural**.
The prototype already serializes every matter and every task on every keystroke
(`updateField` → `persistMatters` → `JSON.stringify` of both collections, with no debounce).
Preserve that interface and swap in HTTP, and every keystroke POSTs 200 matters. You would
then have to refactor the call sites anyway — so you pay twice and ship a period of
unusable slowness in between.

Instead, change the **shape** of the mutation API while still on localStorage. Intents, not
collections:

```
createMatter(input) -> { id, caseNumber }
updateMatterField(matterId, fieldKey, patch)
setChecklistItem(matterId, fieldKey, { done, occurredOn, docUrl, note })
archiveMatter(matterId)
createTask(input) / setTaskComplete(id, bool) / updateTask(id, patch)
```

Zero backend, zero visible change, cannot break anything — the localStorage implementation
of `updateMatterField` is the current `persistMatters` with a narrower signature. Then the
HTTP swap is a transport problem solved once, in one file.

**Side effect worth naming:** this fixes the stale-closure bug at `higdon-cms.jsx:141` *by
construction*. Once the mutation takes `(matterId, fieldKey, patch)`, there is no
whole-collection object to rebuild from a render closure, so two edits in one tick can no
longer lose the first one's chain-task regeneration.

---

## 2026-08-27 · Hybrid schema: typed columns for anything that drives a decision

**A JSONB blob makes it impossible for the database to ever refuse bad data. That is the
entire failure mode of the prototype.** `sol` holding `"TBD"` is not a rendering bug — it
exists only because nothing in the system could reject it.

- **Typed columns** for all six date fields, money as `numeric(14,2)`, and every
  identity/filter/sort field.
- **Child table `matter_checklist_item`**, PK `(matter_id, field_key)`, for the 13 checklist
  items — not 52 columns, not JSONB. The `occurred_on` date feeds Tex. R. Civ. P. 99 and
  must be a real `date` with a range CHECK; the child table makes the audit trail fall out
  for free; and a 14th checklist item becomes a row instead of a migration (the firm *will*
  add items — Pleadings, Liens, and Meds are deferred, not cancelled).
- **JSONB** only for the genuinely shapeless tail: opposing counsel, insurance, referral,
  cross-ref, demands, how settled, check status.

**The clinching argument:** pure JSONB lets you defer the date coercion, and the dates are
the entire product. SOL, trial date, DCO, and the eight chain rules *are* the value
proposition. A `date` column physically cannot accept `"3/1/24"` — so the importer throws,
loudly, at the boundary, instead of you discovering three months later that Trial Countdown
has been silently dropping rows. **Use the schema as the forcing function.**

**Rename `yesnoDoc.date` → `occurred_on`.** It is the date a legal event happened in the
world, and must never be confused with `updated_at` (when a human typed it). The audit trail
needs both, and a column called `date` sitting next to `created_at` invites exactly that
conflation. This is the single most important naming decision in the schema — if those two
facts ever blur, the audit trail cannot answer the only question anyone will ever ask it.

---

## 2026-08-27 · Auth before real data touches any hosted DB — which is not "auth first"

All schema, data-layer, and importer work happens against **local Postgres with synthetic
data**. You need local dev anyway, so this costs nothing.

Profiling the real xlsx **locally** is fine and necessary — reading the file on your own
machine to produce a column report is the same act as opening it in Excel. What must never
happen is real client data in a hosted database or a Vercel preview deployment.

Two things done early rather than retrofitted: the NextAuth tables go in the **first**
migration, and `requireSession()` (with a `DEV_AUTH_BYPASS` env flag) is written into the
**first** route. Then no route is ever written without a guard, and the auth phase shrinks
to configuring a provider and flipping a flag.

**Auth shape:** Google OAuth restricted to the firm's Workspace domain plus a hand-seeded
allowlist, no self-signup. The domain check runs **server-side in the `signIn` callback** —
the OAuth `hd` parameter is client-supplied and spoofable, so it is a UX hint, not a control.
MFA is then inherited from Workspace, which the firm already has.

**No per-matter ACLs at Milestone 1.** Everyone in the firm already sees every matter via
the shared spreadsheet. One `role` column (`admin | attorney | paralegal`) gates destructive
actions and settings, nothing else. Stated explicitly so it does not get gold-plated.

---

## 2026-08-27 · Audit trail is trigger-written, and it ships in Milestone 1

Two reasons a solo part-time dev should care about triggers over application code: you
*will* run a one-off `UPDATE` in a psql session at some point, and app-level auditing misses
it entirely; and it is ~40 lines total instead of a discipline maintained at every call site
forever.

Actor arrives via `set_config('app.actor_id', ..., true)` — transaction-local, so it cannot
leak across Neon's pooled connections. **Make the wrapper the only way to get a writable
transaction handle** (never export raw `db` for writes) or the trail will have anonymous
rows within a month.

**Immutability needs belt and suspenders.** `REVOKE` does not restrain a table *owner*, and
on Neon the app typically connects as owner. So: a `BEFORE UPDATE OR DELETE OR TRUNCATE`
trigger that raises, **and** a dedicated non-owner application role.

**Never write `doc_url` values into the audit table.** Those are Dropbox share links —
bearer-token capability URLs to privileged documents. Duplicating them into an append-only
table you cannot redact is a mistake with no undo. Log `{"docUrl": "set"}`.

**Why Milestone 1 and not later:** it cannot be retrofitted for the period it was missing.
Every other defect on the list can be fixed in month three and the data repaired. If staff
work for three months with no audit trail and a client then disputes when a demand was sent,
that history does not exist and never will.

**And it is not compliance overhead** — it is the only correct implementation of a feature
already shipped in the prototype. `last_activity_at` derived from `max(audit_event.occurred_at)`
replaces the single overwritten timestamp at `higdon-cms.jsx:247`, which fixes three things
at once: unrecoverable history, staleness being bumped by any stray keystroke, and the
"Cases Needing Attention" panel being inert for 30 days after import and then firing on all
200 matters simultaneously.

---

## 2026-08-27 · Case numbers use a counter row, not a Postgres SEQUENCE

Sequences do not roll back, so a failed transaction burns a number. The firm's numbers are
**semantic** — `26-042` means "the 42nd case opened in 2026" — so gaps are wrong, not merely
untidy.

`case_number_counter(year_yy, last_seq)`, allocated in a single atomic
`INSERT ... ON CONFLICT DO UPDATE ... RETURNING`. The row lock is held to commit, so
concurrent callers serialize and a rollback un-burns the number.

Replaces the client-side `Math.max(...used) + 1` scan in `mail-intake.jsx:8-17`, which races
the moment two people use the app. **Seed the counter from imported history** or the first
new case collides.

Two edge cases that will both fire and must fail loudly rather than silently: >999 cases in
one year, and normalizing `"26-42"` / `"26 - 042"` / `"26-042"` to the same value before the
uniqueness check.

---

## 2026-08-27 · Chain-rule notes live in code, not in task rows

Auto-task `title` and `note` are NULL in the database and rendered from the `CHAIN_RULES`
constant at read time.

So `"Tex. R. Civ. P. 99 — Monday next after 20 days from service. Confirm with attorney."`
exists in exactly one place in the system. It cannot drift between rows, cannot be corrupted
by a partial UPDATE, and a correction propagates to every historical task.

The "Confirm with attorney" suffix on every generated task is **load-bearing**. Do not let a
future UI cleanup tidy it away.

`getDue` stays in TypeScript rather than becoming a PL/pgSQL function — it is legal logic
that needs to be readable and unit-tested.

---

## 2026-08-27 · No `CHECK (done implies occurred_on IS NOT NULL)` on checklist items

That constraint would reject the real spreadsheet — which has `Y` cells with no date
anywhere — and force the importer to fabricate dates, trading a visible gap for an invisible
lie.

Instead the gap is **indexed**: `WHERE done AND occurred_on IS NULL`, surfaced as a review
queue and a banner. This matters because five of the eight chain rules gate on
`X.done && X.date`, so a `done` item with no date produces no deadline at all — and the task
list still looks populated. The deceptive-looking-fine failure is the one worth indexing.

---

## 2026-08-27 · Range CHECKs use literal bounds, never `current_date`

Postgres allows `current_date` in a CHECK constraint and it is a trap: constraints are
re-validated on dump/restore, so a row that was legal in 2026 can make a 2031 restore fail.

"Not in 1904" belongs in the CHECK. "Not in the future" belongs in Zod.

---

## 2026-08-27 · The target is a Filevine clone, and Filevine's IA is the architecture

Direction from the firm: match what Filevine does and how it is laid out, because staff use
it daily and the point of building in-house is to remove cost, not to retrain everyone.

This is not a skin. It reorders the build, because Filevine's information architecture is
**two-level** and the prototype's is flat:

- **Global rail:** Tasks · Feed · Project Hub · Documents · global project search
- **Matter shell:** header (`Last, First YY-NNN`, client name, click-to-call phone,
  click-to-email, project-type selector, Vitals toggle) + a **left section rail** + section
  content
- **Section rail** is Higdon's own configured set of 14: Activity, Med Chron Data, Call Log,
  Intake, DCO, Meds, Lost Wages, Liens, Case Summary, Expenses, Parties, Insurance,
  Deadline Chain, Reminders

**Consequence for sequencing: build the shell before the sections.** The section rail is a
**registry** — `{ key, label, icon, component, order, enabled }` — exactly as `FIELDS` is a
registry today. Then a section is a data entry plus one component, and the fourteenth costs
what the second did. Filevine itself configures sections per project type; a registry leaves
that door open without building it now.

**Consequence for the shell: real routing, finally.** `/matters/[id]/[section]`. The
prototype has no router at all (`useState("dashboard")`), so no deep links, no back button,
no way to send someone a link to a matter. Filevine has all three, and staff will expect them.

**The prototype's three panels are not the app; they are three of its screens.** Dashboard,
Cases, and Tasks re-home into the shell as Project Hub and Tasks. That is why the shell
restructure lands *before* the per-record mutation refactor — otherwise every call site gets
touched twice.

---

## 2026-08-27 · Activity ships in Milestone 1, and the audit table is its data source

Activity is the default view of a Filevine matter. The prototype has nothing resembling it,
which makes it the largest single gap against what staff use today — and adoption is won or
lost on first impression.

The convergence that makes this affordable: **the append-only event table already scheduled
for Milestone 1 on legal-defensibility grounds is the feed's backing store.** One table now
earns twice. System rows (field changes, task completions, imports) and human rows (notes,
calls, emails, texts) live in one stream with a `kind` discriminator, which is exactly how
Filevine's Quick Filters behave — one feed, filtered by kind.

Two rules follow from the audit-trail role:

- **Human-authored rows are editable; system rows never are.** The append-only trigger
  guards system rows; notes need normal edit/delete semantics with their own history.
- **The feed is the read model, not the source of truth for state.** A task's completion
  lives on the task row; the feed records that it happened.

Filevine mechanics to reproduce: Pinned group with a count, `@mention` resolving to people
*and* role accounts, per-entry overdue badge / assignee / due date / Complete button inline,
and **"Assign as Task" promoting a plain note in place**.

---

## 2026-08-27 · One task table, two views — not a separate deadlines entity

Filevine shows both a global **Tasks** view and a per-matter **Deadline Chain** section; RLF
models them as two Firestore collections. The prototype merges them into one map with
`source: 'auto' | 'manual'`.

**Keep the single table.** "Deadline Chain" renders the `source='auto'` rows for one matter;
global "Tasks" renders assigned work across matters. Same vocabulary as Filevine, one
entity, and the chain regeneration logic already works this way — the composite
`(matter_id, rule_key)` idempotency key needs no redesign.

Revisit only if the paralegal's actual use shows the two need different fields. A split later
is a migration; a premature split is a second set of routes forever.

---

## 2026-08-27 · Tasks is the landing screen, not a dashboard

Observed directly: logging into Filevine lands on **Tasks** — the current user's list, filtered
to incomplete and assigned to them. There is no dashboard home.

The prototype opens on Dashboard, and the original plan carried that forward without
questioning it. Route `/` to Tasks.

The Dashboard panels aren't wasted — the KPI cards, trial countdown, and stale-case widget are
genuinely useful and RLF's equivalent is one of its standout features. They belong somewhere
reachable, just not as the front door. **What staff need on opening the app is "what do I owe
today," not "how is the practice doing."**

**The left rail is a slot, not a component.** On Tasks it holds due-date buckets (All Due
Dates, On or Before Today, Due Today, Next 7 Days, Next 30 Days) with an item count in the
header; on a matter it holds the section list. The shell owns the rail's *position*; the active
view supplies its *contents*.

---

## 2026-08-27 · A task IS an activity entry — collapse the two tables into one

The single most useful thing the Tasks screenshot settles.

Every task card carries: the matter, an actor line (`<person> created a task • date • time`),
**@mention chips**, **body text that is a real note rather than a title**, **inline
attachments**, an assignee, a due date, a completion button, a pin, and a reply count. That is
a note with an assignee and a due date bolted on — not a separate kind of object.

Filevine's own Notes API agrees: notes are typed `note | task | call | text`.

**So there is one `activity` table, and task-ness is the presence of assignment fields:**

```
activity(
  id, matter_id, kind,              -- note | task | call | text | email | fax | system
  author_user_id, actor_label,
  body, pinned, parent_id,          -- parent_id gives threaded replies
  assigned_to_user_id, due_date,    -- NULL for a plain note
  completed, completed_at, completed_by,
  source,                           -- ui | auto | import | system
  rule_key,                         -- set only when source='auto'
  created_at, ...
)
```

This supersedes the earlier "one task table, two views" entry — same instinct, one table
further. What changes and what doesn't:

- **The chain idempotency survives unchanged.** Partial unique index on
  `(matter_id, rule_key) WHERE source = 'auto'`. Auto deadline tasks are simply rows with
  `kind='task'`, `source='auto'`, and a `rule_key`.
- **Filevine's "Assign as Task" on a note becomes an UPDATE, not an INSERT** — set
  `assigned_to_user_id` and `due_date` on the row that already exists. That is exactly why the
  feature works "in place" in their UI, and it would have been awkward across two tables.
- **Attachments key to `activity`**, not to `matter`. They hang off the entry that introduced
  them.
- **`parent_id`** gives the reply threading implied by the count badge on one card's avatar.
- The append-only audit guard applies to `kind='system'` rows only; human rows edit normally.

Net effect: the `task` table and the separate feed table both disappear into this. One table
backs the Activity section, the global Tasks screen, the firm-wide Feed, and the audit trail.

**Users need a handle as well as a display name.** Mentions render as `@jscholl` / `@orlando4`
while assignment shows `Alex TurnerJr.`, and role accounts like `@hlaccounting` sit
alongside real people. So: `app_user.handle` (unique), `app_user.display_name`, and an
`is_role_account` flag.

---

## 2026-08-27 · Overdue is the normal state, so design for backlog not for alarm

The observed Tasks screen showed **117 open items** *already filtered* to incomplete and
assigned to one person, with visible tasks overdue by months to more than a year.

This is worth recording because it contradicts an assumption in the original plan and changes
several small decisions:

- **Do not build alarm-state UI around overdue.** A red panel that is permanently red gets
  ignored, and then it is worse than nothing — the same reasoning that killed the dead
  notification bell. Overdue needs a calm, sortable badge.
- **Pagination is required on tasks.** The earlier note that pagination was a non-issue was
  about *matters* (200–500). Tasks are a much larger set and the landing screen renders them.
- **Bulk complete and bulk delete are load-bearing, not polish.** Nobody clears a 117-item
  backlog one click at a time.
- **Default filters matter more than the unfiltered view.** Filevine's own default is a narrow
  slice — incomplete, mine, due before a date — and that is the right instinct to copy.

---

## 2026-08-27 · CORRECTION: Dashboard is the landing screen after all

Reverses the "Tasks is the landing screen" entry above. That entry inferred the front door
from Filevine's behavior. The firm's own written requirements say otherwise, and they win.

The boss's requirements note asks, verbatim, for:

> a dashboard with active cases, overdue tasks, inactive cases, and trial within 30/60/90/120
> days with email notifications

That is a precise description of the prototype's existing `DashboardPanel` — its five KPI
cards (Active Matters, Opened This Month, Overdue Tasks, Inactive 30+ Days, Trial Within 120
Days) and its 30/60/90/120 trial-countdown tiers. The prototype was evidently built from this
note.

**So the prototype's divergences from Filevine are not all accidents to be corrected.** Some
are deliberate answers to stated requirements, and the dashboard is the clearest case:
Filevine has no dashboard, the firm asked for one, and one already exists.

**The governing rule from here: Filevine is the layout reference; the requirements note is the
spec. Where they conflict, the note wins.** Filevine's job is to make the app feel familiar,
not to cap what it does.

Practically: `/` routes to **Dashboard**. Tasks, Feed, Project Hub, and Documents sit in the
global rail exactly as Filevine has them, and Dashboard joins them as the home tab. The
rail-as-a-slot decision is unaffected and still correct.

---

## 2026-08-27 · Google Drive, not Dropbox

The prototype models a document as a pasted **Dropbox** URL. The requirements note says:

> have a link upload to upload our Google Drive link with the specific document

And the firm confirmed separately that documents live on Google Drive.

So every `docUrl` is a Drive link. This matters beyond a label change:

- **Drive has a real API and an OAuth story**, so a picker is possible rather than
  paste-a-URL — and eventually reading folder contents, which Dropbox-link-pasting could
  never do.
- **Sharing semantics differ.** A Drive link's access depends on the file's sharing settings
  and the viewer's Workspace identity, where an unauthenticated Dropbox share link is a bearer
  token. If the firm's Drive is in the same Workspace as their Google accounts, this is
  materially *safer* than the status quo, because access follows the person rather than the URL.
- The earlier caution about never logging `doc_url` into the audit table still stands, but the
  exposure it guards against is smaller.

**Open question that changes the design:** the Filevine Documents tab lists PDFs with folder
paths and full-text search, which suggests documents are stored *in Filevine*, not merely
linked. If so, the firm has two document homes today and needs to pick one. Drive plus links
is the cheaper answer and matches the note.

---

## 2026-08-27 · Phase and Tags are first-class, and distinct from status

From the Project Hub screenshot, two matter attributes the prototype has no home for.

**Phase** — observed values `Litigation` and `Settlement`. This is the matter's lifecycle
position and it is **not** the same as the prototype's `status`
(`Open | Closed | Settled - Not Disbursed | Default Judgment`). Filevine carries both: status
is whether the file is open, phase is where it is in the work. Sortable and filterable in the
hub. Add `phase` as its own column with its own option list.

**Tags** — used heavily and doing real work. Observed on matters: `#commercial`, `#lien`,
`#driver`, `#minor`, `#2pls`, `#passenger`, `#SlipNFall`, `#NOFA--FILED`, plus what look like
opposing-firm names. On documents: `#meds`, `#medicals`, `#pleadings`, `#pleadingindex`.

They're serving at least three purposes at once — case characteristics, workflow state, and
counterparty identification. That argues for a **free-form tag table with a many-to-many join,
not an enum**, applied to both matters and documents. The hub shows an overflow indicator
(`+3`) and filters by tag, so tags need indexing, not just storage.

Do not try to normalize these into the status/phase columns. The firm has clearly evolved a
working taxonomy and the fastest way to lose their goodwill is to tell them their tags are
wrong.

Also from the hub, cheap and worth having:

- **`primary_user_id`** — the "Primary" column, the person who owns the file.
- **A numeric legacy Filevine project ID** shown under each project name. **Store it.** It is
  the join key that makes reconciling any Filevine export against the spreadsheet possible,
  and it is free to keep.
- **Project names carry free-text suffixes** — one row read `<Name> 26-044 1st case`. So the
  display name is not strictly derived from `Last, First YY-NNN`; keep a `project_name` field
  rather than always composing it.
- **Matters can be pinned** ("Pinned only" toggle) and **archived** ("Show archived"),
  confirming the soft-delete decision.
- **253 projects**, paginated 100 at a time. Consistent with the earlier estimate.


---

## 2026-08-27 · CORRECTION: a `date` column does not reject `'3/1/24'`

Several entries above claim that a typed `date` column "physically cannot accept `'3/1/24'`",
and that this is the decisive argument for Postgres over Firestore. **The claim is wrong**, and
running `verify.sql` against the real database proved it: the insert succeeded.

Postgres's default `DateStyle` is `ISO, MDY`, so `'3/1/24'` is a valid literal meaning
2024-03-01. It is also heuristic — given `'13/1/24'` it notices 13 cannot be a month and
silently switches to day-first. So the column accepts ambiguous input and *picks an
interpretation without telling anyone*, which is worse than rejecting.

**What survives of the argument**, and it is still substantial:

- The column rejects `TBD`, `n/a`, `see file`, blanks, and impossible dates like `2024-02-30`.
  Firestore would store every one of those as a string.
- The range CHECKs and `sol_after_doa` catch a whole class of wrong-but-parseable dates.
- Money is `numeric`, enums are enums, and the relational constraints hold.

**What has to move to the input boundary:** disambiguation. `parse_iso_date()` in
`002_date_guard.sql` accepts `^\d{4}-\d{2}-\d{2}$` and raises on anything else. The UI is
already safe — an `<input type="date">` cannot emit anything but ISO — so this exists for the
importer, which must call it instead of casting raw cells.

**The wider lesson, worth keeping:** the verification step was worth more than the design it
was checking. A claim this load-bearing should have been tested against a real database before
being written into four documents as settled fact.
