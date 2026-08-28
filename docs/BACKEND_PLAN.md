# Next steps: backend, database, and login

## Context

The frontend is built and passable — seven routes, the Filevine shell, the section registry
with all seventeen sections, tested date math. What it has no database, no users, and no
server.

Everything lives in `localStorage` today, in five keys, behind twenty-one intent functions in
[lib/data/DataProvider.jsx](../lib/data/DataProvider.jsx). That file was written so this step
is a change of **bodies, not call sites** — see [DECISIONS.md](DECISIONS.md), "Do NOT build a
storage-shaped adapter and swap its implementation."

**Confirmed for this phase:**

- Filevine **read access continues for a while**, so there is no emergency cutover.
- The data that goes in first will be a **Filevine export**, which hasn't arrived. `imports/`
  is still empty, so the importer is out of scope here.
- Staff should be able to log into a **real URL early, with synthetic data**, so feedback
  arrives while changes are still cheap.
- **Google Workspace status unknown** — the plan is built so this isn't blocking.

**Outcome:** a deployed, authenticated, Postgres-backed application the firm can log into and
click around, holding fake matters. No real client data until the import is designed and
verified separately.

---

## One decision changes: Better Auth, not NextAuth

The original plan specified **NextAuth**. It shouldn't any more.

**Auth.js (NextAuth) entered maintenance mode in early 2026** — security patches only, no new
features, with active development moved to **Better Auth**. Picking a library in maintenance
mode for a system a law firm will run for years is the wrong trade, particularly for a solo
part-time maintainer who needs the ecosystem to still exist in three years.

**Better Auth is concretely better here, not just newer:**

- **Fully self-hosted, no per-seat cost.** The entire point of this build is escaping
  Filevine's licensing. Auth that bills per monthly active user reintroduces the problem.
- **Native Drizzle support**, matching the ORM already chosen. Sessions live in your Postgres.
- **Google OAuth *and* email/password in one install.** This is the useful part today: you
  don't yet know whether the firm is on Workspace. Build the Google path; if the answer is no,
  enable credentials instead — same library, no migration, no rework.
- Organization and role plugins exist if per-matter access control is ever needed. Not now.

**Unchanged:** Drizzle, Neon, Vercel, the hybrid schema, trigger-written audit,
`case_number_counter`, and the partial unique index carrying chain idempotency.

---

## Step 1 — Local Postgres, Drizzle, the whole schema in one migration · 5–7 evenings

**Done when** `drizzle-kit migrate` runs clean locally, the seed loads ~250 synthetic matters,
and `INSERT INTO matter (sol) VALUES ('3/1/24')` **fails**.

That last check is the entire schema strategy in one line: the database refusing bad data is
what the prototype could never do.

**Files:** `docker-compose.yml` · `drizzle.config.ts` · `lib/db/schema.ts` · `lib/db/index.ts`
· `drizzle/0000_init.sql` (generated) · `drizzle/0001_constraints.sql` (**hand-written**) ·
`lib/db/seed.ts`

Two practical notes:

- **Drizzle cannot express triggers, partial indexes, or CHECK constraints in `schema.ts`.**
  They go in a custom migration via `drizzle-kit generate --custom`. Expect this; don't fight it.
- **Driver: postgres.js against Neon's *pooled* connection string.** Node runtime, not edge —
  chain regeneration plus audit needs real transactions.

The seed should include deliberately awkward rows: a missing SOL, a checklist item done with no
date, a trial date landing on a Saturday. Those are the cases that broke the prototype, and
they should be visible in every screenshot from here on.

### Tables

All in one migration. Writing them together is cheap; retrofitting is not — the same argument
that puts the auth tables here rather than in Step 2.

| Table | Notes |
|---|---|
| `matter` | typed columns for all 6 dates + `numeric(14,2)` money; **`phase` separate from `status`**; `client_phone`, `client_email`, `project_type`, `primary_user_id`, `project_name`, `pinned`, `legacy_filevine_id`, `deleted_at`, `legal_hold`; JSONB tail for shapeless fields |
| `matter_checklist_item` | PK `(matter_id, field_key)`, `done`, **`occurred_on`** (never `date`), `doc_url`, `note`, `updated_by` |
| `activity` | **one table for tasks, notes, calls, texts, emails, and the feed.** `kind`, `body`, `pinned`, `parent_id`, `author_user_id`, nullable `assigned_to_user_id` / `due_date` / `completed`, `source`, `rule_key` |
| `attachment` | keyed to `activity`, not `matter` |
| `matter_section_data` | PK `(matter_id, section_key)`, `fields jsonb` — the generic engine's field group |
| `matter_section_row` | `(id, matter_id, section_key, ordinal, data jsonb)` — the generic engine's collections |
| `tag`, `matter_tag`, `document_tag` | free-form, many-to-many, indexed |
| `audit_event` | append-only, trigger-written |
| `matter_field_issue` | the data-quality queue the importer will fill |
| `case_number_counter` | `(year_yy, last_seq)` |
| `app_user` | `handle` (unique, for `@mention`), `display_name`, `email`, `role`, `is_role_account`, `is_active` |
| `user_alias` | every string a person has been known by, so free-text assignees resolve |
| Better Auth tables | `session`, `account`, `verification` — added now |
| `import_batch`, `import_row` | staging; unused until the export arrives |

### The constraints that matter

```sql
-- Chain idempotency. This IS the mechanism, not an optimization.
CREATE UNIQUE INDEX activity_auto_rule_uq ON activity (matter_id, rule_key)
  WHERE source = 'auto';

-- A soft-deleted bad import must not permanently burn its case numbers.
CREATE UNIQUE INDEX matter_case_number_uq ON matter (case_number)
  WHERE case_number IS NOT NULL AND deleted_at IS NULL;

-- The work queue for the deceptive failure: done, but no trigger date, so no deadline.
CREATE INDEX checklist_done_no_date ON matter_checklist_item (matter_id)
  WHERE done AND occurred_on IS NULL;

-- Literal bounds, never current_date: CHECKs are re-validated on dump/restore, so
-- current_date means a row legal today can break a restore in 2031.
ALTER TABLE matter ADD CONSTRAINT sol_range
  CHECK (sol IS NULL OR sol BETWEEN DATE '1980-01-01' AND DATE '2100-01-01');
ALTER TABLE matter ADD CONSTRAINT sol_after_doa
  CHECK (sol IS NULL OR doa IS NULL OR sol > doa);
```

Deliberately **no** `CHECK (done implies occurred_on IS NOT NULL)`. It would reject the real
spreadsheet and force the importer to fabricate dates — trading a visible gap for an invisible
lie. Index the gap and surface it instead, which the Litigation section already does.

### Audit trail

One generic `AFTER INSERT/UPDATE/DELETE` trigger on `matter`, `matter_checklist_item`,
`activity`, and `app_user`. Actor arrives via `set_config('app.actor_id', $1, true)` —
transaction-local, so it cannot leak across Neon's pooled connections.

Two things easy to miss:

- **`REVOKE` does not restrain a table owner**, and on Neon the app usually connects as owner.
  Add a `BEFORE UPDATE OR DELETE OR TRUNCATE` trigger that raises, **and** connect as a
  dedicated non-owner role.
- **Never write `doc_url` values into `audit_event`.** Those are capability URLs to privileged
  documents; an append-only table you cannot redact is the wrong home for them. Log
  `{"docUrl": "set"}`.

---

## Step 2 — Better Auth: a real login · 3–4 evenings

**Done when** logged out, every page redirects and every API route returns 401; a
non-allowlisted account is rejected; three seeded staff accounts work.

**Files:** `lib/auth/server.ts` · `lib/auth/client.ts` · `app/api/auth/[...all]/route.ts` ·
`app/login/page.jsx` · `middleware.ts` · `lib/server/session.ts` · `lib/db/seed-users.ts`

`requireSession()` is written **here** and used by every route in Step 3, so no route is ever
written without a guard.

- **No self-signup.** Accounts are seeded. A five-person firm doesn't need a signup flow, and
  every signup flow is attack surface.
- **If Workspace:** verify the email domain **server-side in the sign-in callback**. The OAuth
  `hd` parameter is client-supplied and therefore a UX hint, not a control. MFA is then
  inherited from Workspace, which is strictly better than anything I'd build.
- **If not Workspace:** enable email/password, seeded accounts only. A reset flow becomes
  necessary — add ~2 evenings and a transactional mail sender.
- **One `role` column** (`admin | attorney | paralegal`) gating destructive actions and
  settings. **No per-matter ACLs** — everyone already sees every matter via the shared
  spreadsheet. Stated explicitly so it doesn't get gold-plated.
- Session ~12 hours with an idle timeout. A checkbox, not a project.

---

## Step 3 — API routes, server-side chain, audit · 6–8 evenings

**Done when** the whole app can be driven from `curl`, every write lands an `audit_event` row
with a non-null actor, and `PATCH`ing `served.done` returns the regenerated Answer Due task in
the same response.

Routes mirroring the twenty-one intents already in `DataProvider.jsx`:

- `app/api/matters/route.ts` — GET (slim list), POST (create)
- `app/api/matters/[id]/route.ts` — GET (full), PATCH (one field), DELETE (archive)
- `app/api/matters/[id]/checklist/[fieldKey]/route.ts` — PUT
- `app/api/matters/[id]/sections/[sectionKey]/route.ts` and `.../rows/[rowId]`
- `app/api/tasks/route.ts` and `app/api/activity/route.ts` — **two views over the one
  `activity` table.** The frontend keeps its two collections; the server presents both, so the
  table merge costs no client rewrite.
- `lib/server/matters.ts` — service layer · `lib/schemas.ts` — Zod, one per route

Four things this step must get right:

1. **Chain regeneration runs in the same transaction as the write that triggered it.**
   `generateChainTasks` in [lib/domain/chain.js](../lib/domain/chain.js) is already
   framework-free for exactly this reason — import it server-side, upsert on
   `(matter_id, rule_key)`, and preserve the retraction rule exactly: an auto task whose
   trigger disappears is deleted *unless* completed or overridden.
2. **Server-side case-number allocation** via `case_number_counter`, inside the create
   transaction. `createMatter` assigns none today, so every new matter reads "(no case #)".
3. **The importer and the UI share one Zod schema.** No "import mode" bypass — that is how the
   prototype ended up with a `<select>` for `status` in the UI and arbitrary CSV strings in the
   same column.
4. **Slim list projection** for Project Hub. Not pagination — just not shipping every field of
   250 matters to render a table of names.

---

## Step 4 — Swap the data layer to HTTP · 4–5 evenings

**Done when** typing 40 characters into Demands produces **one** PATCH, a checklist toggle
PATCHes immediately, and killing the server mid-edit shows "Not saved".

Only two new files, which is the payoff for how `DataProvider.jsx` was written:
`lib/data/http.js` and `lib/data/write-queue.js`.

- **Local state stays the render source.** Inputs are never controlled by a round-trip, so
  there is no typing lag, ever.
- **Debounce free text only (~500 ms). Discrete fields flush immediately** — checklist
  toggles, selects, dates. Every field carrying legal weight is discrete, so none of them ever
  sit in a buffer.
- Forced flush on blur, route change, and `visibilitychange`.
- `SaveIndicator` already exists and already renders "Not saved" — wire real failures into it.
  The prototype had `.catch(() => {})` at four persist sites, so a silent save failure on a
  legal file was reachable.

---

## Step 5 — Deploy, protected, with fake data · 2–3 evenings

**Done when** staff can log in at a real URL and click around ~250 synthetic matters.

- Vercel project, Neon production branch, env vars set
- **Deployment protection ON before the first push.** Vercel previews are public by default; a
  preview URL pointed at real data would be a confidentiality incident with a public address.
  The data is fake right now, which is exactly why this is the moment to build the habit.
- Migrations from CI or by hand — **never `drizzle-kit push` against a database with data**
- **≥30 days PITR on Neon**, plus a manual `pg_dump` before every migration, forever
- Seed production with **synthetic data only**

Then collect feedback for a week or two. This is the cheapest information in the project: a
paralegal saying "this field is missing" costs minutes now and a migration later.

---

## Step 6 — Then, and only then: the Filevine export

Blocked on the export arriving. When it does, the first task is an **inventory**, not an
importer: what came out, in what format, at what fidelity. That answer decides whether the
section work is transcription or archaeology.

Everything already written for this holds — staging tables, dry run, dedupe on `case_number`,
the five-quality date coercion, and the rule that `ambiguous` and `unparseable` never silently
become a date. See [ROADMAP.md](ROADMAP.md) Phase 14.

---

## Verification

| Step | Check |
|---|---|
| 1 | `INSERT INTO matter (sol) VALUES ('3/1/24')` fails · `npm test` still green (22 tests × 3 timezones) · seed loads 250 matters |
| 2 | Logged out, `curl` every route → 401 · a non-allowlisted Google account is refused · three staff accounts work |
| 3 | Drive the app from `curl` alone · every write has an `audit_event` row with an actor · toggling `served` returns the Answer Due task in the same response |
| 4 | Network tab: 40 keystrokes → 1 PATCH · checklist toggle → immediate PATCH · kill server → "Not saved" |
| 5 | Log in from another machine · an unauthenticated preview URL is unreachable |

**Manual pass before calling it done** — the same walkthrough that verified the frontend, now
against Postgres: create a matter → it gets a real `YY-NNN` → mark Served done → Answer Due
appears with the Rule 99 note verbatim → override the date → the override survives a matter
edit → restore it → archive the matter → it leaves every dashboard panel → the activity feed
shows every step with the right actor.

**Regression guard:** the existing 22 tests must keep passing untouched. `lib/domain/*` is
framework-free and the server imports the same modules, so a green suite after Step 3 is real
evidence that server and client compute deadlines identically.

---

## Effort

Roughly **20–27 evenings, 50–70 hours** — 6 to 11 weeks at 6–10 hours a week — to a deployed,
authenticated, database-backed app holding synthetic data. Import and real cutover follow
separately.

## Open items

1. **Google Workspace, yes or no?** Shapes Step 2. Better Auth covers both, so it isn't
   blocking, but the answer saves rework. Credentials add ~2 evenings and a mail sender.
2. **The Filevine export** — still nothing in `imports/`. Read access continues, so not urgent,
   but the window is finite and the export is what makes the thirteen generic sections real
   rather than guessed.
3. **Staff list** — names, emails, handles for the seeded allowlist. Include role accounts like
   the accounting alias, or `@mentions` won't resolve.
4. **Chain-rule sign-off from Paul** on all eight rules. Still outstanding, still a
   legal-review deliverable rather than a coding task.
