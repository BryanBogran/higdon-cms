# Email on the case file

Two ways a message gets onto a matter. The first works right now; the second is
the one that scales, and needs a DNS change.

---

## 1. Drag a `.eml` onto the feed — works today

Open a matter → **Activity** → drag the message anywhere onto the feed, or use
**Add email file**. Several at once is fine.

Getting a `.eml` out of a mail client:

| Client | How |
|---|---|
| Gmail | Open the message → **⋮** → **Download message** |
| Outlook on the web | Open the message → **⋯** → **Download** |
| Apple Mail | Drag the message to the desktop |
| Outlook desktop (Windows) | Saves `.msg`, which **cannot** be read. Forward it to the case address instead, or open the message in Outlook on the web. |

The app detects a `.msg` by its file signature rather than its extension, so
renaming it does not help — it tells you what to do instead of failing oddly.

### What is stored

The original `.eml`, every attachment, and the parsed headers. The original is
kept deliberately: if the parse is ever wrong, the message itself is still the
evidence on the file.

**Before `003_email.sql` is run**, the app falls back to keeping headers only —
the card says so in amber rather than showing a link that cannot work.

---

## 2. The per-matter address — no DNS change

Every matter has its own address, shown at the top of its Activity tab with a
**Copy** button:

```
files+AdetanAbimbolaMichelle7f3a9c2e1b04@higdonlawyers.com
```

CC, BCC or forward to it and the message files itself onto that matter.

### Why this shape, and not a subdomain

The original design used `slug@case.higdonlawyers.com`, which is a nicer
address and needs an MX record. Two facts about this firm changed the answer:

- **DNS is on Wix** (`ns6.wixdns.net`), whose editor is limited, and
  Cloudflare Email Workers — the free option — needs the domain on Cloudflare
  nameservers. Moving them would migrate the live website and the live mail to
  gain an email feature.
- **Mail is on Google Workspace**, and the firm already runs a service account
  with domain-wide delegation for Drive.

So everything goes to one real mailbox, `cases@higdonlawyers.com`, using
Gmail's plus-addressing. **No MX record is involved**, which removes the single
most dangerous step in this feature: an MX record put on `higdonlawyers.com`
instead of `case.higdonlawyers.com` stops every client and carrier email until
somebody notices.

The trade is an uglier address, about a minute of delay instead of
instant, and the fact that a few web forms reject `+` in an address. For CC and
forward from Outlook or Gmail — which is how staff will actually use it — none
of those bite.

The subdomain form is still supported. Clear `NEXT_PUBLIC_INTAKE_MAIL_USER` and
set the domain back, and every address returns to the old shape.

### Setup

**a. Pick the mailbox.** `files@higdonlawyers.com` — the account the service
account already impersonates for Drive — works and costs nothing extra. No new
user is required.

Three things follow from reusing it:

- **The poller must not touch its other mail.** `files@` receives ordinary
  mail, and a script that marked all of it read would hide a colleague's inbox
  from them. So the script processes ONLY messages that carry the tagged
  address and leaves everything else exactly as found — unread, unlabelled,
  never POSTed. That is what `CMS_PREFIX` is for.
- **The addresses read `files+…`**, not `cases+…`. If the nicer word matters,
  add `cases@higdonlawyers.com` as an **alias** of `files@` — aliases are free
  in Workspace — and use `cases` as the user. Verify it with one test email
  before handing addresses out: an alias should keep the plus tag in
  `Delivered-To`, and if it does not, the tag is invisible on a BCC.
- **One account, two capabilities.** The service-account key already reaches
  all of Drive as `files@`; polling adds that mailbox to the same blast radius.
  For a firm this size that is a reasonable trade, and worth knowing you made
  it.

A group will NOT work in place of a user: it does not keep the plus tag in
`Delivered-To`, and that header is how a BCC'd address is recovered.

**b. Generate the shared secret:**

```bash
openssl rand -hex 32
```

**c. Set it in Vercel** (Project → Settings → Environment Variables), together
with the address shape:

```
INBOUND_EMAIL_SECRET          <the value from above>
SUPABASE_SERVICE_ROLE_KEY     <from Supabase → Project Settings → API>
NEXT_PUBLIC_INTAKE_MAIL_DOMAIN  higdonlawyers.com
NEXT_PUBLIC_INTAKE_MAIL_USER    files
NEXT_PUBLIC_INTAKE_MAIL_LIVE    true
```

`NEXT_PUBLIC_INTAKE_MAIL_USER` is the mailbox everything lands in — `files` if
you are reusing that account, `cases` if you added the alias.

⚠️ An environment change does not apply to a build that already exists.
**Redeploy** afterwards.

**d. Install the poller.** Sign in as `files@higdonlawyers.com`, open
[script.google.com](https://script.google.com), create a project, and paste
[`docs/scripts/gmail-intake.gs`](scripts/gmail-intake.gs).

In **Project Settings → Script Properties** add:

| Property | Value |
|---|---|
| `CMS_WEBHOOK` | `https://<your-app>.vercel.app/api/inbound-email` |
| `CMS_SECRET` | the same secret as above |
| `CMS_PREFIX` | `files+` — must match `NEXT_PUBLIC_INTAKE_MAIL_USER` plus a `+` |
| `CMS_POLL_MINUTES` | optional. `1`, `5`, `10`, `15` or `30`. Defaults to `1`. |

Then run **`testConnection`** once from the editor and approve the permission
prompt. A `200` with `"filed": 0` is the correct answer — the test message
names no case.

Finally run **`installTrigger`** once. It schedules `pollInbox` every minute
by default — Apps Script's fastest interval, and comfortably inside the six
hours of daily trigger runtime a Workspace account gets. To change it, set
`CMS_POLL_MINUTES` and run `installTrigger` again; the old trigger is removed
first, so it never doubles up.

**e. Test it.** Open any matter, copy its address, and send it an email from
your own account. Within a minute or so it appears on that matter's Activity
tab.

### What the script does, and what it will not do

It reads unread mail, POSTs **only the messages carrying the tagged address**,
and labels those threads `CMS/Filed`. Anything else in the mailbox is left
untouched — not read, not labelled — which is what makes it safe to run on
`files@`. A message is marked read **only** on a 2xx — a network
failure leaves it unread so the next run retries, because a transient error
must never lose a client's email. A 4xx labels the thread `CMS/Failed` and
stops retrying it, so a bad secret does not hammer the endpoint forever.

Anything over 25 MB is flagged rather than truncated. Half a message is not
evidence.

---

**The sender is not verified, and cannot be.** SMTP has no authentication worth
the name and a From header is trivially forged, so a message arriving at a
known intake address proves only that someone knew the address. Every row
records the envelope sender and whether SPF/DKIM passed; `meta.verified` says
which. Treat an unverified message the way you would treat an unverified
letter.

**The intake address is a capability.** Anyone who learns it can post to that
case file. The random half is twelve hex characters so the addresses cannot be
walked, but they should be treated like any other internal identifier.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| "This matter has no email address yet" | `supabase/003_email.sql` has not been run. |
| Card says attachments were not kept | Running on localStorage — Supabase is not configured. |
| Webhook returns 503 | `INBOUND_EMAIL_SECRET` or `SUPABASE_SERVICE_ROLE_KEY` unset. It fails closed on purpose. |
| Webhook returns 401 | The `x-inbound-secret` header is missing or wrong. |
| `{"filed":0,"reason":"no intake address in recipients"}` | The case address was not among the recipients. If it was BCC'd, the provider is not sending the envelope — SendGrid needs the raw MIME option ticked. |
| Nothing happens on a re-drop | Already on this matter. The count line says so; the dedupe key is the Message-ID. |
