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
