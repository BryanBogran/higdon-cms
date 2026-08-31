# Google Drive as the document store

The firm keeps **one Drive folder per case, named with the client name**, and
those folders are not moving. So Drive holds the files and this app holds an
**index** of them: enough to search, filter and show a Documents page without
duplicating a single byte.

Confirmed from public DNS: `higdonlawyers.com` MX points at
`aspmx.l.google.com`, so the firm is on Google Workspace. G Suite Business
includes Shared Drives.

---

## Do the smaller half first

There are two levels, and **you almost certainly only need the first one today.**

| | Level 1 — read | Level 2 — write |
|---|---|---|
| What you get | Browse and search every case's Drive folder | Upload from the app; create folders |
| Admin console needed | **No** | Yes — domain-wide delegation |
| Extra Workspace licence | **No** | Yes, for a `files@` account |
| Scope | full `drive`, self-granted — bounded by what is shared | full `drive`, acting as `files@` |
| Setup | Share a folder with the service account, like sharing with a colleague | L2a–L2e below |

**Start at level 1 unless you need uploading today.** No admin console, no extra
licence, and it already gives you browsing and search across everything that
exists — including the text inside PDFs and Docs.

Level 2 is additive: nothing from level 1 is undone or redone.

## The trap at level 2, so it isn't a surprise later

**A service account has zero storage quota.** It can read anything shared with
it, but a file it would *own* fails to upload with `storageQuotaExceeded` — even
though its Drive is completely empty. Two ways round it: write into a Shared
Drive, or impersonate a real user.

Because the case folders are staying where they are, level 2 uses
impersonation. `GOOGLE_IMPERSONATE_USER` is which real person the robot acts as,
and it must be a **durable** account — never an individual's, because everything
the app creates would be owned by them and offboarding puts the firm's documents
in the deletion path.

---

# Level 1 — reading, ~15 minutes

### 1. Create the Google Cloud project and service account

1. <https://console.cloud.google.com> → **New Project** → name it
   `higdon-cms`.
2. **APIs & Services → Library** → search **Google Drive API** → **Enable**.
3. **APIs & Services → Credentials → Create credentials → Service account**.
   - Name: `higdon-cms-drive`
   - No roles needed. Drive access comes from delegation, not from IAM.
4. Open the new service account → **Keys → Add key → Create new key → JSON**.
   A file downloads. **This file is a credential — do not commit it, do not
   email it, do not paste it into chat.** You will copy two values out of it.
5. On the service account's **Details** tab, copy the **Unique ID** (a long
   number). This is its OAuth client id, needed in step 2.

### 2. Share the case folders with the service account

Open the Drive folder that **contains** the per-case folders → **Share** → paste
the service account's email (`...@higdon-cms.iam.gserviceaccount.com`) →
**Viewer** → Send.

That is the whole grant. It works exactly like sharing with a colleague: no
admin console, no delegation, no licence, and the app can see nothing else in
anyone's Drive.

Then set `GOOGLE_IMPERSONATE_USER=""` — empty. The code omits the impersonation
claim and authenticates as the service account itself, which is all a read
needs.

### 3. Find the root folder id

Open the folder in Drive that *contains* the per-case folders. The id is the
last part of the URL:

```
https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz
                                       └──────── this ────────┘
```

⚠️ Point this at the folder holding the case folders, **not** at My Drive
root. The sync walks everything beneath it.

### 4. Environment variables

In Netlify → Site settings → Environment variables, and in `.env.local`:

```
GOOGLE_SERVICE_ACCOUNT_EMAIL="higdon-cms-drive@higdon-cms.iam.gserviceaccount.com"
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEv...\n-----END PRIVATE KEY-----\n"
GOOGLE_DRIVE_ROOT_FOLDER_ID="1AbCdEfGhIjKlMnOpQrStUvWxYz"

# Empty at level 1. Only set at level 2, and only to a durable account.
GOOGLE_IMPERSONATE_USER=""
```

Both come out of the JSON key file (`client_email` and `private_key`).

⚠️ **No `NEXT_PUBLIC_` prefix on any of these.** That prefix inlines a value
into the browser bundle at build time; on the private key it would publish
Drive access to every visitor.

⚠️ The private key contains newlines. Keep them as literal `\n`, exactly as
they appear in the JSON file. The code converts them back. A key pasted with
real line breaks produces a signature error that says nothing about newlines.

### 5. Run the migration

`supabase/004_documents.sql` in the Supabase SQL editor. Confirm with:

```bash
node --env-file=.env.local scripts/check-db.mjs
```

### 6. Dry run first

Open **Documents → Google Drive sync** and press **Dry run**. It reads Drive,
matches folders to cases, and **writes nothing**. You get four numbers: already
linked, will link, needs review, unmatched.

**Read those numbers before applying.** If "will link" is near zero, the root
folder id is probably wrong. If "needs review" is most of them, the folder
names differ from the client names in the app more than expected.

---

---

# Level 2 — uploading from the app

Everything below is needed to upload. Reading works without it.

**About 20 minutes, and it costs one Workspace licence.**

---

## Why it cannot be avoided

**A service account owns no Drive storage.** It reads anything shared with it,
but a file it would *own* is refused with `storageQuotaExceeded` — even though
its Drive is empty. There is no setting that grants it quota.

The way round is **domain-wide delegation**: the app acts as a real user, and
files land owned by that person. Since the firm is not moving its case folders,
this is the option that fits.

## ⚠️ The scope has to be the broad one, and here is why

`drive.file` looks like the right answer — per-file, least privilege — and it
does not work. **It only ever covers files the app itself created.** Your case
folders were made by people, years ago, so an app holding `drive.file` cannot
see them, cannot list them, and cannot upload into them. It fails with *"File
not found"* on a folder plainly visible in Drive.

So the scope is:

```
https://www.googleapis.com/auth/drive
```

That is full access to whatever the impersonated account can reach — which is
precisely why the next step matters more than it looks.

## L2a. Create a dedicated account

Admin console → **Directory → Users → Add new user**.

```
files@higdonlawyers.com
```

A real Workspace user, so it consumes a licence (~$14/month).

**Do not impersonate a person.** Not yours, not Paul's. Two reasons, and both
bite later:

1. **Blast radius.** With the full `drive` scope the app can do anything that
   account can. Impersonating an attorney hands it their entire Drive. `files@`
   can reach only what you share with it — the scope is broad, the identity is
   narrow, and that is the actual control.
2. **Ownership.** Everything the app creates is owned by that account. If the
   person leaves and IT deletes them, the firm's documents are in the deletion
   path.

## L2b. Share the case folders with `files@` as Editor

Open the folder that **contains** your per-case folders → **Share** → add
`files@higdonlawyers.com` → **Editor** → Send.

Editor, not Viewer. Viewer is enough to read; uploading needs write.

## L2c. Authorise domain-wide delegation

**The quickest way to get both values is to have them printed for you:**

```
node scripts/check-google-delegation.mjs ~/Downloads/service-account.json files@higdonlawyers.com
```

That reads the JSON key file you downloaded when the key was created, prints
the exact Client ID and scope to paste, and then tests delegation and says
which half is broken. It needs no environment variables. Run it again after
saving the Admin console entry — a pass there is the confirmation.

### The same thing by hand

⚠️ **One number, three names.** The Admin console calls it *Client ID*, the
Cloud console calls it *Unique ID*, and the JSON key file calls it `client_id`.
They are all the same 21-digit number. It is **not** the OAuth client id ending
in `.apps.googleusercontent.com`, which is a different thing entirely and is
the usual reason for `unauthorized_client`.

1. Either read `client_id` from the service-account JSON file:

   ```
   node -e "console.log(require('/full/path/to/service-account.json').client_id)"
   ```

   or, if you no longer have that file: Google Cloud console → **IAM & Admin →
   Service Accounts** → click the account → **Details** → **Unique ID**.
2. <https://admin.google.com> → **Security → Access and data control → API
   controls → Domain-wide delegation** → **Add new**.
3. **Client ID:** the number from step 1.
4. **OAuth scopes:**

```
https://www.googleapis.com/auth/drive
```

⚠️ If you set this up earlier with `drive.readonly` and `drive.file`, **edit
that entry and replace the scopes** rather than adding a second one. Delegation
matches on client id, and a stale entry with narrow scopes is a confusing way to
fail.

## L2d. Set the variable

```
GOOGLE_IMPERSONATE_USER="files@higdonlawyers.com"
```

In Vercel this is **Config**, not Secret — it is an email address, not a
credential. Then redeploy: environment changes do not reach existing builds.

## L2e. Check it

Open any linked case → **Docs** → **Upload**, or drag a file onto the list.

A progress bar appears and the file shows in the folder within a second or two
of finishing. The bytes go from your browser straight to Google — they never
pass through this app — because a serverless request body is capped at a few
megabytes and a scanned record clears that easily.

### If it refuses

| Message | Cause |
|---|---|
| `Uploading needs GOOGLE_IMPERSONATE_USER` | L2d not done, or not redeployed. The app checks before asking you to pick a file. |
| `storageQuotaExceeded` | The variable is set but delegation is not authorised, so the token is still the service account. Re-check L2c. |
| `File not found` on a visible folder | The delegation scope is still `drive.file`. It only covers app-created files. Replace it with full `drive`. |
| `insufficient permissions` | `files@` has Viewer, not Editor, on the folder. |
| `unauthorized_client` | The client id in L2c does not match, or the scope string has a typo. It must match character for character. |

---

## How matching works, and why it refuses to guess

Folders are named with the client name only, so the first match is a fuzzy
comparison of two human-typed strings entered years apart. The rule:

> **Nothing auto-links unless exactly one matter matches and nothing else is
> even close.**

Two clients called Smith? Neither links — both go to review. An exact match
sitting next to a near-miss (`Smith, John` and `Smith, John Robert`)? Also
review. A folder of medical records attached to the wrong client is a privilege
breach; an unlinked folder is a dropdown. Those costs are not close.

Once a folder is linked, **its Drive id is stored on the matter and name
matching never runs for it again.** Renaming a client, fixing a typo, or a
second Smith arriving next year cannot silently re-point an existing case at
someone else's records.

A case number in the folder name (`Smith, John 26-002`) overrides all of this —
it is the one identifier both systems agree on.

Sixteen tests cover this, including the same-name and near-miss cases.

---

## What is NOT verified

**Everything in `lib/google/drive.js` is written but has never run against real
Drive**, because that needs the credentials above. The matching logic is pure
and tested; the API calls are not. Expect the first dry run to surface
something — most likely a wrong root folder id or a missed delegation scope.

Run the dry run first for exactly that reason.

---

## The split I need to close

Email attachments currently land in **Supabase Storage**, not Drive — that was
built before this decision. So a HIPAA authorisation that arrives by email goes
one place, and the same document filed by hand goes another.

That is wrong and it is mine to fix: once Drive is confirmed working, email
attachments should upload into the matter's Drive folder like everything else.

The one thing I would keep in Supabase is the raw `.eml` original, because that
bucket has no UPDATE and no DELETE policy — it is tamper-evident in a way Drive
is not. The attachments are documents; the `.eml` is evidence of a message.
That is a judgement call and worth disagreeing with.

---

## Troubleshooting

| Error | Cause |
|---|---|
| `unauthorized_client` | Delegation not authorised for this client id, or a scope typo. Re-check step 2 — the scope string must match exactly. |
| `invalid_grant` | The impersonated user does not exist, or the server clock is skewed. |
| `storageQuotaExceeded` | An upload at level 1. Expected — reads work, writes need level 2. |
| Dry run finds 0 folders, and you are at level 1 | The parent folder is not shared with the service account's email. That is the level-1 grant. |
| Dry run finds 0 folders | Wrong root folder id, or the impersonated user cannot see it. |
| A Shared Drive folder returns nothing | Every call already sends `supportsAllDrives`; check the impersonated user is a member of that Shared Drive. |
| `Could not sign the token` | `GOOGLE_PRIVATE_KEY` newlines. See step 4. |
