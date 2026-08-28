# Filevine: last-day extraction checklist

**Access ends tomorrow.** The team is already exporting case records. This list covers what
that export will almost certainly **miss** — configuration and layout, which don't look like
"data" but are equally unrecoverable once the license lapses.

Documents are on Google Drive, so the client files themselves are not at risk. Good. That
frees today for everything below.

Rough order of value. If you only get through Part 1, that's the important half.

---

## Part 1 — Configuration (30–45 min, highest value)

This is the part that saves the most rebuild time. Every item here is a setting somebody
chose deliberately, and reconstructing it from memory later is guesswork.

- [ ] **Project Template export, for every project type.** *The single most valuable file on
      the list* — it turns ten of the fourteen sections from guesswork into configuration.

      **Path:** Main Menu → Advanced → **Customs Editor** → select Org → select the template.
      Whole template via the Import/Export dropdown; a single section via the export icon
      beside it.

      **It is two clicks, not one.** The export icon *generates* a file; you then click the
      generated file to download it. Easy to generate one and never actually save it.

      **Permission needed first — check before anything else:** Org Admin, plus access to the
      Customs Editor and the "Import/Export Custom Templates" advanced tool, granted in the
      **Advanced Access** tab. If you don't have these, chasing whoever does is the urgent
      task, not the export itself.

      **Included:** all fields and widgets, plus locked / required / visibility.
      **NOT included: auto-tags and auto-move settings.** If a field auto-tags a document or
      auto-moves a matter to the next phase, that behavior is in no export file. Screenshot
      the field settings for anything you know behaves that way.

      **Repeat per project type.** The matter we looked at showed `UIM`, so there are others;
      each is its own template and its own export.

      **If the permission can't be sorted in time:** screenshot the **Customs Editor** itself
      rather than the live matter pages. It shows every section with its fields and types in
      one structured view — one screenshot of the editor is worth about five of a populated
      matter.
- [ ] **The project type list**, and which template each one uses. (The matter we looked at
      showed `UIM`, so there is more than one.)
- [ ] **Phase list per project type** — the stages a matter moves through.
- [ ] **Every dropdown's option values.** Usually inside the template export; verify rather
      than assume by opening the file. These are tedious to reconstruct and easy to get
      subtly wrong.
- [ ] **Deadline chain definitions** — Filevine's native chaining rules: trigger → offset →
      deadline name. High value: this maps directly onto the eight rules already built, and
      will show which ones the firm actually relies on plus any we don't have.
- [ ] **Task / workflow templates** — the auto-created task lists per project type or phase.
- [ ] **Document folder templates** per project type.
- [ ] **Contact types and party roles** — client, opposing party, witness, expert, adjuster,
      plus any custom ones.
- [ ] **User list**: names, emails, roles. Include **role and team accounts** — the matter we
      looked at had at least one accounting alias alongside individuals, and @mentions won't
      map correctly without them.
- [ ] **Tag list.** The Activity view showed hashtags (a document-signature status tag).
- [ ] **Saved reports, filters, and views** — someone built these because they answer a
      question the firm asks often. Worth knowing what those questions are.
- [ ] **Vitals panel configuration** — which fields the firm chose to surface at a glance.
      That's a direct statement of what matters most on a matter.
- [ ] **Notification and automation settings** — what currently fires, to whom, when.

## Part 2 — Layout (20–30 min)

Structure tells us *what* the fields are. These tell us *how it looks*, which is the whole
point of matching Filevine.

- [ ] **Screenshot every one of the fourteen sections** on one representative matter. Full
      page, scrolled to the bottom — not just what fits above the fold.
- [ ] **A 3–5 minute screen recording** walking one matter end to end: open it, move through
      sections, add a note, complete a task, open the Vitals panel. Captures interaction and
      transitions that screenshots can't.
- [ ] **Project Hub / matter list**, including its column layout and any grouping.
- [ ] **Global Tasks view**, **Feed**, and **Documents**.
- [ ] **The Vitals panel expanded.**
- [ ] One matter that is **messy and mature** — lots of activity, many parties, expenses
      filled in. A clean demo matter hides how the sections behave under real load.

## Part 3 — Verification baseline (10 min, do not skip)

**You cannot validate an export without knowing what "complete" looks like — and after
tomorrow you can't get the count.** This is ten minutes that protects the whole migration.

- [ ] **Record counts**, written down: total projects (and open vs. closed), notes/activity
      entries, tasks, deadlines, contacts, documents.
- [ ] **Pick three matters** — one active, one settled, one closed — and record their key
      values by hand: case number, client, SOL, trial date, DCO, and a couple of checklist
      items. These become the spot-check that proves the import worked.
- [ ] **Confirm the export actually opens.** Unzip it, open a file, count some rows. A
      completion message is not evidence.

---

## What NOT to do

- **Don't let anyone hand-clean or "tidy up" the export.** Raw and messy is worth more than
  cleaned and lossy — every normalization decision made in a hurry today is one we can't see
  or reverse later. The import pipeline is built to handle mess and to flag what it can't read.
- **Don't reformat dates**, or open-and-resave spreadsheets in a way that reformats columns.
  Excel silently rewrites date cells and that's the hardest class of damage to detect.
- **Don't skip an export because "we have that in the spreadsheet."** The spreadsheet tracks
  the litigation checklist and dates. It does not contain the Activity history, the parties,
  the expenses, or the notes — which for many matters is the only written record of what
  happened and why.
- **Don't rely on API access today.** If it isn't already set up, standing up token auth,
  discovering pagination, and validating output is not a one-day job. Use the UI exports and
  the team already doing the work.

## Where to put it

Everything lands in `/imports/` in this repo — **already gitignored**, verified. Keep the
original filenames and the original folder structure; don't rename or flatten anything.

A second copy somewhere outside this machine is worth the two minutes.

---

# Second capture — updated 2026-08-28, **days of access left**

The first pass got 11 sections out of a HAR and made five of them `verified` in
`lib/sections/registry.js`. This list is what we now know is *still* missing,
in strict value order. **If you only do Part A, that is the important half.**

Everything here is unrecoverable once the license lapses. The Google Drive
documents are safe; none of this is in them.

## Part A — 20 minutes, highest value

### A1. A HAR from a matter that has data in the six empty sections

Six sections came back with zero rows last time, so we have their names and
nothing else:

`call-log` · `intake` · `dco` · `lost-wages` · `liens` · `case-summary`

**These are guesswork in our build right now.** A field list beats any amount
of design discussion.

The trick is picking the right matter. Find **one older, fully worked-up,
preferably settled case** — those have every section filled. Then:

1. DevTools → Network → tick **Preserve log** → **Clear**.
2. Open the matter and **click every section in the left rail**, top to bottom.
   Wait for each to finish loading before the next.
3. Right-click in the Network list → **Save all as HAR with content**.
4. Save into `imports/` — it is gitignored, so nothing leaks into the repo.
5. Run: `node scripts/extract-sections.mjs imports/<file>.har`

⚠️ **The extractor redacts values by allowlist**, so patient data does not get
written into a markdown file. Do not disable that. Field *names* are the point;
field *contents* are not.

### A2. Screenshot the section rail, top to bottom

One screenshot of the left-hand rail of an open matter, showing every section in
order. We match section ORDER by guess today, and staff navigate that rail by
position all day long. Cheapest possible fix.

### A3. The phase list, in order

**Project Hub → the Phase filter dropdown** shows every phase for the template.
Screenshot it. Ours (`lib/domain/phases.js`) has nine invented ones — PNC,
Intake, Treatment, Demand, Negotiation, Litigation, Settlement, Disbursement,
Closed. Phase drives task automation, so a wrong list means wrong tasks fire.

### A4. Vitals, in order

Open a matter → the **Vitals flyout** → **Configure**. Screenshot the full list
with its ordering. Vitals are the header summary fields; we have a fixed header
and no equivalent, and this tells us which fields the firm actually reads first.

## Part B — 10 minutes if there is time

### B1. Deadline chain definitions

**Setup → Deadline Chains** (or Advanced → Customs Editor → the template's
deadline chains). Screenshot each chain's steps and day offsets. Our
`lib/domain/sequences.js` has two chains reconstructed from a *marketing video*,
using a federal case-management order that is very likely not the firm's.
Getting this wrong produces confidently wrong dates on a docket.

### B2. Task templates per phase

Anywhere Filevine lists "when a project enters phase X, create these tasks".
`lib/domain/phases.js` has seven flows invented from one worked example in the
same video.

### B3. Reminder settings

Confirm the ladder is genuinely **90 / 60 / 30 / 15** — the firm has now said it
is, and this is a two-second visual check that the setting agrees.

### B4. Mailroom

Screenshot the Mailroom list view: its columns, its filters, and what the
actions on a message are. It is the next thing being built and we have only a
one-line description of it from Filevine's public docs.

## Part C — only if everything above is done

- The saved reports the firm actually uses — names and columns.
- Document folder structure on a worked-up matter.
- Team/permission setup, if anyone has admin access.
- Any auto-tag or auto-move field behaviour, which **appears in no export file**.

---

## What NOT to spend time on

- **Documents.** Already on Google Drive.
- **Case data.** The team's export covers it.
- **Anything you can describe from memory.** Your description of a screen is
  worth more than a rushed, half-loaded HAR of it.
