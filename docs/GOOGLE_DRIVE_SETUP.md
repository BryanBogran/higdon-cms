# Google Drive as the document store

The firm keeps **one Drive folder per case, named with the client name**, and
those folders are not moving. So Drive holds the files and this app holds an
**index** of them: enough to search, filter and show a Documents page without
duplicating a single byte.

Confirmed from public DNS: `higdonlawyers.com` MX points at
`aspmx.l.google.com`, so the firm is on Google Workspace. G Suite Business
includes Shared Drives.

---

## The one thing that trips everyone up

**A service account has zero storage quota.** It can read anything shared with
it, but a file it would *own* fails to upload with `storageQuotaExceeded` —
even though its Drive is completely empty. There are exactly two ways round it:

1. Write into a **Shared Drive**, where the organisation owns the storage.
2. Use **domain-wide delegation** so the account acts as a real user.

Because the case folders are staying where they are, this setup uses **option
2**. The app impersonates a real user, and new files land in the existing
folders, owned by the firm.

---

## Setup — about 30 minutes, all of it yours to do

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

### 2. Authorise domain-wide delegation

⚠️ This is the step that grants the app access to Drive as a user. Grant only
the two scopes below — they are the least privilege that works.

1. <https://admin.google.com> → **Security → Access and data control → API
   controls → Domain-wide delegation** → **Add new**.
2. **Client ID:** the Unique ID from step 1.5.
3. **OAuth scopes**, comma-separated, exactly these two:

```
https://www.googleapis.com/auth/drive.readonly,https://www.googleapis.com/auth/drive.file
```

`drive.readonly` lets it index what already exists. `drive.file` lets it create
files, and can only ever see files **this app created** — it is not a second
read grant.

### 3. Pick the user to act as, and the root folder

- **Impersonated user:** whoever owns the case folders today, or a dedicated
  `files@higdonlawyers.com`. Everything the app creates will be owned by this
  account, so a departing employee's account is the wrong choice.
- **Root folder:** open the folder in Drive that *contains* the per-case
  folders. The id is the last part of the URL:

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
GOOGLE_IMPERSONATE_USER="files@higdonlawyers.com"
GOOGLE_DRIVE_ROOT_FOLDER_ID="1AbCdEfGhIjKlMnOpQrStUvWxYz"
```

Both come out of the JSON key file (`client_email` and `private_key`).

⚠️ **No `NEXT_PUBLIC_` prefix on any of these.** That prefix inlines a value
into the browser bundle at build time; on the private key it would publish
Drive access to every visitor.

⚠️ The private key contains newlines. Keep them as literal `\n`, exactly as
they appear in the JSON file. The code converts them back. A key pasted with
real line breaks produces a signature error that says nothing about newlines.

### 5. Run the migration

`supabase/004_documents.sql` in the Supabase SQL editor.

### 6. Dry run first

```bash
curl -s https://<your-site>/api/drive/sync --cookie "<your session>" | jq
```

Or from the app once the Documents page is wired. It reads Drive, matches
folders to cases, and **writes nothing**. You get four numbers: already linked,
will link, needs review, unmatched.

**Read those numbers before applying.** If "will link" is near zero, the root
folder id is probably wrong. If "needs review" is most of them, the folder
names differ from the client names in the app more than expected.

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
| `storageQuotaExceeded` | `GOOGLE_IMPERSONATE_USER` is unset, so the service account is trying to own the file. |
| Dry run finds 0 folders | Wrong root folder id, or the impersonated user cannot see it. |
| A Shared Drive folder returns nothing | Every call already sends `supportsAllDrives`; check the impersonated user is a member of that Shared Drive. |
| `Could not sign the token` | `GOOGLE_PRIVATE_KEY` newlines. See step 4. |
