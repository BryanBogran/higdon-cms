# Setup — from zero to a deployed, logged-in app

Everything the code can do is done. What's left needs your accounts, so it's yours to run.
Roughly **45 minutes** end to end.

Work through it in order. Each step says how to tell it worked.

---

## 1. Create the Supabase project · 5 min

1. Go to **supabase.com** → New project.
2. Region: **East US** or **Central US** — closest to Houston.
3. Save the database password in your password manager. You won't need it often, and you
   cannot recover it later.

Wait for provisioning (~2 min).

---

## 2. Run the schema · 5 min

1. In the Supabase dashboard: **SQL Editor** → New query.
2. Paste the entire contents of [`supabase/schema.sql`](../supabase/schema.sql) and **Run**.
3. Expect `Success. No rows returned.`
4. New query → paste [`supabase/002_date_guard.sql`](../supabase/002_date_guard.sql) → **Run**.

If it errors, copy the message to me — the file is idempotent, so re-running after a fix is
safe.

### Then prove it works · 2 min

New query, paste [`supabase/verify.sql`](../supabase/verify.sql), Run, and read the
**Messages** tab:

```
PASS 1a: non-date text rejected
PASS 1b: impossible calendar date rejected
NOTE:    Postgres read '3/1/24' as 2024-03-01 (DateStyle=ISO, MDY)
PASS 1d: parse_iso_date refuses ambiguous input
PASS 1e: parse_iso_date accepts real ISO dates
PASS 2:  sol_after_doa enforced
PASS 3:  case_number_format enforced
PASS 4:  case number uniqueness enforced
PASS 5:  activity_auto_rule_uq enforced
PASS 6:  audit_event is append-only
```

**Read the NOTE line — it is the important one, and it corrects something I got wrong
earlier.** A `date` column does *not* reject `'3/1/24'`. Postgres's default DateStyle is
`ISO, MDY`, so it accepts that string and decides it means March 1st. Given `'13/1/24'` it
silently switches to day-first instead.

So the database's real protection is: it rejects `TBD`, `n/a`, blanks, and impossible dates
like Feb 30, and it enforces the range and `sol_after_doa` checks. It cannot disambiguate
`3/1/24`, and no database can — only a human knows which the firm meant. **That is why
`parse_iso_date()` exists and why the importer must never cast raw spreadsheet cells.**

The last query should return **zero rows** — every table confirming RLS is on.

---

## 3. Connect the app · 5 min

**Project Settings → API**, then create `.env.local` in the project root — the same folder as
`package.json`. It's gitignored, so it never leaves your machine.

> **Copy the Project URL, not the REST endpoint.** The dashboard shows both, and they look
> nearly identical. You want `https://xxxx.supabase.co` — if what you copied ends in
> `/rest/v1/`, trim that off. The client appends `/rest/v1/...` itself, so the longer form
> produces `PGRST125: Invalid path specified in request URL` on every query, with an error
> message that points nowhere near the cause. (The app now trims this for you, but the URL is
> clearer without it.)
>
> **Use the publishable key, never the secret key.** The publishable key respects Row Level
> Security and is safe in a browser. The secret key bypasses RLS entirely — putting it behind
> a `NEXT_PUBLIC_` prefix would inline it into the JavaScript bundle and hand every case in the
> firm to anyone who views source.

```bash
NEXT_PUBLIC_SUPABASE_URL="https://YOUR-PROJECT.supabase.co"
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="eyJ..."
```

Restart the dev server. The app switches from browser storage to Supabase automatically —
there's no flag to flip.

```bash
npm run dev
```

You should be redirected to `/login`, and the amber "Supabase isn't configured" warning should
be gone.

> The publishable key is **public by design** — it ships in the browser bundle. What keeps your
> data private is Row Level Security, which step 2 turned on. That's why the verify script
> checks it.

---

## 4. Turn off self-signup, then create the accounts · 10 min

**Authentication → Sign In / Providers → Email**

- **Turn OFF "Enable sign ups".** A five-person firm doesn't need a signup flow, and every
  signup flow is a way in.
- Turn **off** "Confirm email" for now, so accounts work immediately without mail setup.

**Authentication → Users → Add user → Create new user** for each person. Tick *Auto Confirm
User*.

A profile row is created automatically for each. Then set handles and roles in the SQL editor,
so `@mentions` resolve:

```sql
update profile set handle = 'aturner',  display_name = 'Alex Turner Jr.', role = 'attorney'
  where email = 'CHANGE-ME@higdonlawyers.com';

update profile set handle = 'praman', display_name = 'Priya Raman',      role = 'paralegal'
  where email = 'CHANGE-ME@higdonlawyers.com';

-- Role accounts matter: the Filevine feed showed @hlaccounting alongside real
-- people, and mentions won't resolve without them.
update profile set handle = 'hlaccounting', display_name = 'Accounting', is_role_account = true
  where email = 'CHANGE-ME@higdonlawyers.com';

select handle, display_name, email, role, is_role_account from profile order by handle;
```

**Now log in.** You should land on the Dashboard, empty.

---

## 5. Load demo data · 2 min

SQL Editor → paste [`supabase/seed_demo.sql`](../supabase/seed_demo.sql) → **Run**.
It returns `demo_matters: 25`, and it's safe to re-run — it clears its own rows first.

The seed deliberately includes the cases that broke the old system, so they're visible rather
than hidden behind tidy data:

- a matter with **no SOL** → shows in the dashboard's Missing Key Dates panel
- a trial date on a **Saturday** → shows the weekend warning on the Deadline Chain
- `26-005` has a checklist item **done with no date** → shows *"no deadline is being
  calculated"* on the Litigation tab

Reload the app. Dashboard fills in; Project Hub lists 25 cases.

**Deadlines appear when you open a matter.** The chain is computed client-side from the tested
rules and written back on first edit, so open one and toggle a checklist item to see the
Deadline Chain populate.

---

## 6. Deploy · 15 min

1. Push to a **private** GitHub repo.
2. **vercel.com** → Add New → Project → import it.
3. Add both `NEXT_PUBLIC_SUPABASE_*` variables under Environment Variables.
4. **Before the first deploy finishes: Settings → Deployment Protection → enable it.**
   Vercel preview URLs are public by default. Fake data today makes this cheap to get right;
   real data later makes it a confidentiality incident.
5. Back in Supabase: **Authentication → URL Configuration** → add your Vercel URL to
   **Redirect URLs**, or login will bounce.

### Also do these two, they take a minute each

- **Supabase → Settings → Add-ons → Point-in-Time Recovery.** This is your entire
  disaster-recovery story.
- Log in from your phone. Cross-device is the proof it's really a database now.

---

## Where you are after this

A real Postgres database, real accounts, data shared across devices and users, deployed behind
login, with an audit trail recording every change from the first write.

**With synthetic cases in it.** Loading the real ones needs the Filevine export, column
profiling, and date coercion — and rushing that is how a wrong SOL gets stored as fact. That's
the next piece of work, and it deserves its own day.

## If something breaks

| Symptom | Cause |
|---|---|
| Redirect loop at `/login` | Vercel URL missing from Supabase Redirect URLs |
| "Supabase isn't configured" persists | `.env.local` not picked up — restart the dev server |
| Saves show "Not saved" | RLS blocking, or you're signed out. Check the browser console. |
| Empty app despite rows in the table | RLS policy missing on that table — re-run `schema.sql` |
| A date won't save | Working as designed. Postgres rejected a malformed date; check the value. |
