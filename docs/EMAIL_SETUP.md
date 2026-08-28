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

## 2. The per-matter address — needs one DNS record

Every matter gets its own address, shown at the top of its Activity tab with a
**Copy** button:

```
SmithJane7f3a9c2e1b04@case.higdonlawyers.com
```

CC, BCC or forward to it and the message files itself on that matter. This is
Filevine's mechanism, and once set up it costs nothing per message.

### ⚠️ The subdomain is not optional

The MX record goes on **`case.higdonlawyers.com`**, never on
`higdonlawyers.com`. Pointing an MX record at the firm's own domain redirects
the firm's live mail — every client email, every carrier email, gone until it
is reverted. A subdomain cannot touch it.

### Setup

**a. Pick a provider.** Any of these can POST a raw message:

| Provider | Notes |
|---|---|
| **Cloudflare Email Workers** | Free. Needs the domain on Cloudflare. |
| **SendGrid Inbound Parse** | Free tier. Tick **"POST the raw, full MIME message"**. |
| **Mailgun Routes** | Paid. Use the `store()` action with a forward URL. |

**b. Add the MX record** for `case.higdonlawyers.com`, per the provider.

**c. Generate the shared secret:**

```bash
openssl rand -hex 32
```

**d. Set the server-side variables** (in Netlify → Site settings → Environment
variables, and in `.env.local` for local work):

```
INBOUND_EMAIL_SECRET=<the value from step c>
SUPABASE_SERVICE_ROLE_KEY=<Supabase → Project Settings → API → service_role>
NEXT_PUBLIC_INTAKE_MAIL_DOMAIN=case.higdonlawyers.com
NEXT_PUBLIC_INTAKE_MAIL_LIVE=true
```

⚠️ Neither secret takes a `NEXT_PUBLIC_` prefix. That prefix inlines a value
into the browser bundle at build time; on the service-role key it would publish
full database access — RLS and all — to every visitor.

**e. Point the provider at:**

```
https://<your-site>/api/inbound-email
```

with the header `x-inbound-secret: <the value from step c>`. If the provider
cannot send custom headers, put the secret in the URL path instead — the same
strength, but far more likely to end up in someone's access log.

**f. Check it:**

```bash
curl https://<your-site>/api/inbound-email
```

`{"ok":true,"configured":true}` means both secrets are set. `configured:false`
means the webhook will refuse everything until they are.

---

## What is deliberately not claimed

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
