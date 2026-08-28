# How to feed me Filevine

Four ways to get Filevine's behaviour into this project, ranked by how much I learn per
minute you spend. Use whichever fits; they combine well.

**Scope note.** We are cloning **layout, vocabulary, and workflow** — that is the whole point,
and it is fine. We are not copying Filevine's code, CSS, or assets. Everything in this repo is
our own implementation of the same shape.

---

## Method 1 — Let me drive your browser · best by a distance

Install the **Claude in Chrome** extension and sign in. I can then open Filevine in your
already-authenticated session and inventory it myself: every section, every field, every
button, every dropdown's options — directly, with no transcription step and nothing lost in
the retelling.

This is the difference between me reading a description of a section and me *opening* it.

**Guardrails I will hold to, and you should hold me to:**

- **Read only.** I will not click Save, Delete, Send, or anything that writes to a live legal
  file. If a workflow can only be understood by performing it, I will describe what I would
  click and ask you to do it.
- **No client data comes back.** I am capturing *structure* — field names, types, dropdown
  options, button labels. Client names, medical details, and settlement figures stay in
  Filevine. Where I need an example value I will note the shape, not the content.
- **You watch.** The browser is yours; you can see every page I open and stop me at any point.

**What I would do with 30 minutes of access:** walk all fourteen sections on two matters — one
sparse, one mature — and write the real field list for each straight into
`lib/sections/registry.js`. That single pass replaces the guessed configuration for ten
sections, which is currently the largest known gap in the clone.

---

## Method 2 — A HAR file · richest single artifact, no install

Filevine is a single-page app, so every screen fetches its structure and data as JSON. Your
browser can record all of it to one file.

1. Open a matter, press **F12** → **Network** tab
2. Tick **Preserve log**, click 🚫 to clear
3. Click through **every section in the left rail**, slowly, letting each finish
4. Then **Project Hub**, **Tasks**, **Feed**, **Documents**
5. Right-click any request → **"Save all as HAR with content"**

Newer Chrome calls it *"with sensitive data"* — that's the one. The sanitized export strips
response bodies, which is the only part that matters.

⚠️ **A HAR contains your session token. Treat it like a password.** Drop it in `/imports/`
(gitignored) and don't email it around.

**What I get:** the actual entity shapes, field keys, enum values, and relationships Filevine
uses internally. More than screenshots can ever show.

---

## Method 3 — A screen recording with narration · best for *actions*

Structure tells me what the fields are. Only watching someone work tells me what the buttons
**do**.

Record 5–10 minutes of a paralegal doing their real daily loop, talking as they go. QuickTime
(⌘⇧5 on a Mac) or Loom. Narration matters more than video quality — *"now I mark this served,
and it creates the answer deadline automatically, but I always check it against the docket"*
is worth more than a hundred clean screenshots.

**Most valuable to record, in order:**

1. **The daily loop** — whatever they do twenty times a day. Optimising that beats ten rare
   features.
2. **Opening a new matter** end to end.
3. **A section with real behaviour** — Expenses or Deadline Chain, not a static field list.
4. **Something that annoys them.** The workarounds reveal what the system gets wrong, and
   those are free wins for us.

---

## Method 4 — Written workflow notes · no technical skill needed

Hand this to whoever actually uses Filevine. One block per workflow, plain language:

```
WORKFLOW: <what you're doing>
HOW OFTEN: <daily / weekly / rarely>

  1. <where you click>
  2. <what you type or pick>
  3. <what Filevine does on its own>

WHAT WOULD GO WRONG if this were missing:
WHAT ANNOYS YOU about how Filevine does it:
```

That last line is the valuable one. We are not obliged to reproduce Filevine's mistakes.

---

## What is actually worth capturing

Capture is cheap; building is not. A feature is a few hours, so the ranking matters more than
the volume.

| Priority | What | Why |
|---|---|---|
| **1** | Field lists for the 13 generic sections | Currently guessed. Turns configuration into fact. |
| **2** | Filevine's native deadline-chain rules | Maps onto the eight rules already built; shows which the firm relies on and which we're missing |
| **3** | The paralegal's daily loop | Where the time actually goes |
| **4** | Per-section *actions* — buttons beyond add/edit/delete | The part no screenshot reveals |
| **5** | Dropdown option values | Tedious to reconstruct, easy to get subtly wrong |
| **6** | The Vitals panel config | A direct statement of which fields the firm considers most important |

## What I already have

- Activity, Tasks, Feed, Project Hub, Documents — layout captured from screenshots
- The matter header, the section rail, and all fourteen section names
- `YY-NNN` case numbering, phases, tags, and the "Assign as Task" promotion
- The requirements note, which is the spec

## What is still guesswork

- The field list inside **ten of the fourteen sections**
- What each section can *do* beyond listing rows
- Filevine's own deadline-chain definitions
- Anything that only appears mid-workflow — modals, confirmations, side effects
