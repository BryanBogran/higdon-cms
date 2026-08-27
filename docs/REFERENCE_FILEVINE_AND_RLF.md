# Reference: Filevine's layout and the RLF CMS

Two external reference points, and what to take from each.

1. **Filevine** — what Higdon staff use today. The layout target: matching it is how the
   firm avoids a learning curve.
2. **RLF CMS** (Riley Law Firm) — a working in-house system for a solo plaintiff practice.
   Static HTML + Firebase/Firestore + Netlify Functions. 121 files, 25 Firestore
   collections, ~35 serverless functions, ~23 of them AI-backed. Shipped and in daily use.

> The RLF export contains no client data (it was scrubbed for redistribution). The Filevine
> reference is a screenshot of a live Higdon matter, so it contains real client PII — the
> case-number format and the layout are recorded below; the client's identifying details are
> deliberately not.

**Shared lineage confirmed.** RLF's SOL reminder offsets are `120, 90, 60, 30` — identical
to `REMINDER_OFFSETS` in Higdon's `pi-intake.jsx`. The two systems are relatives, which is
why so much of RLF transfers cleanly.

---

## 1. Filevine's information architecture

This is the layout to match. It is **two-level**, and the Higdon prototype's flat top-nav
(Dashboard / Cases / Tasks) does not resemble it.

**Global top bar:** Tasks · Feed · Project Hub · Documents · global project search

**Matter header:** `Last, First YY-NNN` — confirming the `YY-NNN` case numbering
independently of the README (the observed matter was `26-048`). Alongside it: client name,
**click-to-call phone, click-to-email address**, a project-type selector (the observed value
was `UIM` — underinsured motorist), and a "Vitals" panel toggle.

**Matter left nav** — the section list, which is the heart of the layout:

| Filevine section | Higdon prototype status |
|---|---|
| **Activity** *(default view)* | **absent entirely** |
| Med Chron Data | absent |
| Call Log | absent |
| Intake | separate unwired tool (`pi-intake.jsx`) |
| DCO | one date field |
| Meds | absent |
| Lost Wages | absent |
| Liens | absent |
| Case Summary | absent |
| Expenses | absent |
| Parties | absent (free-text `opposingCounsel`, `attorney`) |
| Insurance | one free-text field |
| **Deadline Chain** | `CHAIN_RULES` — already named identically |
| Reminders | queue exists but has no producer |

**Two findings that change scope:**

- **The "seven missing Filevine sections" I deferred to Milestone 2+ are not a feature
  backlog — they are the navigation.** In Filevine you reach everything about a matter
  through that list. A port that ships Cases + Tasks + Dashboard and calls the sections
  "later" will not feel like Filevine, because the sections *are* the interface.
- **Activity is the default view of a matter, and the prototype has nothing like it.** This
  is the single biggest gap between the prototype and what the firm currently uses.

**The Activity feed's observed mechanics:** a chronological stream of notes, emails, faxes,
phone calls, texts, tasks, and reminders; Quick Filters down the side to isolate one kind; a
**Pinned** group at the top with a count; `@mention` tokens that resolve to people *and*
role accounts (an accounting alias appeared alongside individuals); an inline "Add new
activity…" composer; per-entry overdue badges, assignee, due date, and a "Complete Task"
button *inside the feed entry*; **"Assign as Task" on a plain note**, promoting it in place;
and trending hashtags surfacing document-signature status.

Note the staffing implication: the observed matter had four distinct named actors plus a
role account. **Higdon is not a two-person firm**, which matters in §3.

---

## 2. What to take from RLF

Ranked by value to Higdon, with the specific mechanism.

### 2.1 The reminder engine — solves Higdon's dead notification queue

`netlify/functions/send-reminders.js`, cron `30 13 * * *` (08:30 Central). This is precisely
the producer Higdon's prototype lacks.

- Each deadline document embeds `reminders: [{ daysBefore, date, sent }]`. The scheduled job
  finds entries where `date === today && sent === false`, sends, then flips `sent: true`.
  **The `sent` flag is the idempotency key** — the same shape as the `trial-tier-fired` key
  the Higdon README describes but never implemented.
- **The morning brief is sent every weekday even when there is nothing to report.** Worth
  copying deliberately: it makes silence unambiguous. An empty inbox then means "the job
  ran and there's nothing," not "the job died."
- Each recipient's own tasks and calls lead their copy, followed by shared items.

### 2.2 `todayInFirmTz()` — a better one-liner than I had planned

```js
new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
```

`en-CA` formats as `YYYY-MM-DD`, and `timeZone` pins it to Central. This replaces the
hand-rolled helper in the Phase 2 plan for the "what is today" question specifically. Date
*arithmetic* still uses integer math — see §3.2.

### 2.3 Weekend and holiday handling that warns instead of moving

`getHolidayName(dateStr)` computes the federal holiday table for any year — fixed-date
holidays plus nth-weekday rules (MLK, Presidents', Memorial, Labor, Columbus, Thanksgiving)
and, pragmatically, the day after Thanksgiving. `checkBadDate(dateStr)` returns
`'Saturday'`, `'Sunday'`, or the holiday name.

**The design choice is the valuable part: it warns and offers a "move" button rather than
silently rolling the date forward.** That is the right answer to the Tex. R. Civ. P. 4
rollover gap flagged in the roadmap's open questions — a computed deadline landing on a
holiday is surfaced to a human, not quietly adjusted by software.

### 2.4 The deadline chains RLF implements that Higdon doesn't

All plain `addDays` in code, with a review screen before saving:

| Trigger | Generated |
|---|---|
| Answer filed / service | initial discovery +30d · Ch. 74 expert report +120d · records task +14d |
| Discovery served | response +30d · **internal "draft objections" +2d** |
| Trial date set | pretrial disclosures −30d · depo-scheduling task −90d · mediation task |
| Ch. 74 report served | 21-day objection window → supplemental report deadline, or record a waiver |

Two ideas Higdon's eight rules lack: **counting backward from the trial date**, and **short
internal lead-time reminders** (+2 days to draft, not just the 30-day external deadline).
The Ch. 74 chain matters only if Higdon takes med-mal; their `pi-intake.jsx` already encodes
§74.351, so probably yes.

### 2.5 PNC (Potential New Client) intake

RLF's standout feature, and a clear upgrade over Higdon's manual `pi-intake.jsx` form. Paste
*anything* — email, web form, voicemail notes, screenshot, or a call recording (transcribed
first) — and it extracts contact, case type, incident date, at-fault party, insurance, and
key facts into a **pre-filled review screen**. Then:

- flags SOL concerns and red flags before anyone commits time
- **checks existing matters for name/phone/email match so a repeat caller doesn't become a
  duplicate** — directly relevant to Higdon's dedupe problem
- suggests a starter task list, uncheck what doesn't apply
- one click creates matter + contact + tasks together
- if it's not a fit, drafts a reason-based decline email as a Gmail *draft*, never sent

### 2.6 Task-list ergonomics

Cheap to build, high daily value, and the roadmap's Phase 10 already needs a task-edit
surface: drag-and-drop priority ordering; a "prioritize mode" that re-ranks by typing
position numbers instead of dragging one at a time; bulk complete/delete; **completed tasks
hidden by default** with a "Show Completed" toggle (struck through when shown); and **tasks
on a closed matter drop off the working board automatically** — not deleted, still on the
matter's own tab.

### 2.7 Smaller wins

- **Quick Note** on both dashboard and matter: rich text, voice dictation, drag-and-drop
  attachments, optional one-click AI call-summary and action-item extraction.
- **Quick Contact Add** — paste an email signature, business card, or letterhead and it
  fills the contact form (name, firm, bar number, phones, emails, address, category).
- **Date calculator** on the dashboard — add/subtract calendar days, business days, weeks,
  months, or years, with an option to skip federal holidays, then jump straight to creating
  a task or event for the result.
- **Dropbox folder link per matter**, browsable and pickable from the matter page, storing
  only the path. Strictly better than Higdon's per-document pasted URLs.
- **One-click case closure** archiving a complete PDF case summary.
- **AI case status reports** — per matter or all-active in one pass, in labeled sections
  (Overview, Current Status, Actions Taken, Strategic Next Steps, Assessment), exportable to
  Word/PDF, with **"Request Changes"** to revise in place. Suggested action items are
  surfaced separately and de-duplicated against what's already tracked.
- **Click-to-call** — every phone number anywhere in the system is a live link handing off
  to the VOIP softphone. Filevine does this too; it needs a softphone Higdon controls.
- **Per-matter chat thread** plus a firm-wide thread, in one unified inbox with unread
  badges — keeps case discussion attached to the file.
- **Gmail sync** filing case email under the right matter, plus **AI email triage** on an
  hourly cron flagging urgent or unmatched mail.

---

## 3. What NOT to copy

### 3.1 The stated AI discipline is contradicted by the code

The capabilities document states the principle exactly right:

> AI only extracts facts stated in the uploaded document — it never computes a deadline
> itself. Plain date-math applies the actual rule, with a weekend/holiday check and a review
> screen before any date is saved.

**That holds for the statutory chains** (answer, discovery, Ch. 74, pretrial all use plain
`addDays` in page code). **It does not hold in `extract-notice.js`**, whose prompt instructs
the model to *"Convert relative phrases like 'fourteen days before the hearing' or 'no later
than 30 days prior' into concrete YYYY-MM-DD dates"* and to *"compute the actual date using
today"*.

**For Higdon, hold the line: the model extracts the anchor date and the rule text it found;
code does the arithmetic.** Deadline math is the one thing in this system that must be
inspectable and unit-testable, and a date produced inside a language model is neither.

### 3.2 The date helpers are better than Higdon's but still not right

RLF parses with `new Date(dateStr + 'T12:00:00')` before `toISOString()`. The noon anchor is
a genuine improvement — it survives DST and any offset within ±12h, where Higdon's
`T00:00:00` breaks at UTC+ — but it is still local-timezone-dependent arithmetic. The
roadmap's integer-based approach (parse to three integers, compute with `Date.UTC`, format
back) stands.

### 3.3 JSON-in-a-fence with no schema validation

Every AI function does `JSON.parse` on text after stripping ``` fences, with no tool use, no
schema, and no retry — the same weakness as Higdon's `mail-intake.jsx`. Use structured tool
use so the model retries on a schema mismatch instead of throwing into a generic catch.

### 3.4 Stale model IDs

`claude-sonnet-4-6` (11 call sites), `claude-haiku-4-5-20251001` (12), and one
`claude-sonnet-4-20250514`. New work should target the current generation — Sonnet 5 for
extraction and drafting, Haiku 4.5 where latency and cost dominate.

### 3.5 626KB single HTML files

`matter_detail.html` is 626KB and `index.html` 459KB, each a whole application in one file
with inline `<script>`. Keep Higdon's React component structure.

### 3.6 Two operational traps

- **`SECRETS_SCAN_ENABLED = "false"`** in `netlify.toml` disables the host's secret scanner.
  Do not carry that habit over.
- **Netlify's credit model pauses the entire site when credits run out**, not just the AI
  features — and the setup guide warns that heavy AI use can exhaust a month's allowance.
  The hosting differs, but the lesson transfers: **AI cron jobs are a budget surface that
  can take the whole app down.** Cap and alert on them.

### 3.7 The two-person assumption doesn't generalize

RLF is built around exactly two timekeepers — the dashboard splits tasks into "JB Only /
Both / CL Only" columns, and `assignedTo` is an enum of `JB | CL | Both` hardcoded into AI
prompts. Higdon has at least four named staff plus role accounts. **Do not copy the
two-column split or the two-value assignee enum.** Real user rows with FK assignment, as
already specified in the roadmap's schema.

---

## 4. Schema gaps this exposes in the Higdon prototype

Fields Filevine shows in the matter header or sections that `FIELDS` has no home for:

- **Client phone and client email.** The prototype has `clientName` and nothing else — no
  way to contact the client, and no possible click-to-call. Filevine puts both in the header.
- **Case / project type** (the observed matter read `UIM`). `commercial`
  (Commercial / Personal Lines / Self-Insured) describes the *coverage*, not the case type,
  and `pi-intake.jsx` already carries a seven-entry `CASE_TYPES` table with per-type SOL
  rules that the main app cannot store.
- **A Parties entity.** `attorney`, `opposingCounsel`, and `insurance` are free-text strings
  on the matter; Filevine has a Parties section and a linked contact database.
- **Government-entity notice deadlines.** Already flagged in the roadmap as unrepresentable,
  and the reason the `Self-Insured / Government` option is currently a trap: the 6-month
  notice deadline is usually nearer than the 2-year SOL.

---

## 5. The Tasks landing screen (second observation)

A screenshot of the **first screen on login** — and it is **Tasks, not a dashboard.** The
prototype opens on Dashboard; Filevine opens on the logged-in user's task list. Corrected in
the roadmap.

> Real client data again, so structure only below — no names or case details transcribed.

### The left rail is contextual, not fixed

For Tasks it holds **due-date buckets**: All Due Dates · On or Before Today · Due Today ·
Next 7 Days · Next 30 Days, under a header showing the item count. On a matter it holds the
section list. Same rail, different contents depending on the global-nav selection — so the
shell should treat the rail as a slot the active view fills, not a fixed component.

### Filter chips are a first-class control

The toolbar carries sort (`↑ Due Date`), an `Assigned to` dropdown, and a `Filter` menu.
Active filters then render as **individually removable chips** — `Incomplete ⊗`,
`Assigned to Me ⊗`, `Due on or Before <date> ⊗` — plus **Clear Filters** and **Reset
Filters** as separate actions. Three view-density toggles sit at the right.

Worth copying wholesale. It makes the current query visible and reversible, which a
dropdown-only filter UI does not.

### The finding that matters: a task *is* an activity entry

Each card carries, in one object:

- the **matter** it belongs to, as a link, titled `Last, First YY-NNN`
- an **actor line** — `<person> created a task • <date> • <time>`
- **@mention chips** resolving to short handles (`@jscholl`, `@orlando4`) *and* role accounts
  (`@hlaccounting`), distinct from display names like `Alex TurnerJr.`
- **body text** — a real note, not a title
- **attachments** inline, with type icons and an expander (a `.jpg`, a `.PDF`)
- **assignee** and **due date**, both inline-editable via dropdowns on the card
- a **Complete Task** button
- an **Overdue** badge, a **pin**, and a kebab menu
- on one card, a **count badge on the avatar** — threaded replies

So a task is a note that happens to carry an assignee, a due date, and a completion state.
That is exactly what Filevine's Notes API implies (typed `note | task | call | text`), and it
**collapses two tables in the plan into one.** See the decision entry.

### Task volume is not exceptional — it's the normal state

The header read **117 items** with filters already narrowed to *incomplete, assigned to me*.
Visible tasks were overdue by **months to over a year**, and still open.

Design consequences, none of them cosmetic:

- **Overdue is not an alarm state, it's the default.** A dashboard panel that lights up red on
  overdue tasks would be permanently red and therefore ignored. The prototype's "Overdue
  Tasks" panel would show 117+ items on day one.
- **The list must be fast and paginated at hundreds of rows**, contradicting the earlier
  assessment that pagination was a non-issue at 200–500 matters. That was about *matters*;
  tasks are a bigger set.
- **Bulk operations are essential, not ergonomic polish** — nobody clears a 117-item backlog
  one click at a time. Reinforces borrowing RLF's bulk complete/delete.
- **Sort and filter defaults carry real weight.** The useful default is a narrow slice, not
  everything.

### Minor notes

- A **"Use new Tasks"** toggle sits top-right: Filevine is mid-migration to a rebuilt Tasks
  UI, and this screenshot is the new one. Worth knowing we're cloning the current design.
- Global bar: ☰ · Tasks · Feed · Project Hub · Documents · project search · a
  document-create icon · a layers icon · help · avatar menu.
