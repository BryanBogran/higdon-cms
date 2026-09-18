-- ---------------------------------------------------------------------
-- 018 — let the firm see each other's work
--
-- "things that I've entered in HigVine, Mireya is unable to see on her
--  HigVine. I'm not sure what that's about."
--
-- Nothing was wrong with what she entered. The app read the database once
-- when the page opened and never looked again, so every screen showed the
-- case as it was whenever that tab happened to be opened.
--
-- 017 stopped a stale copy DESTROYING other people's work. This stops the
-- copies going stale in the first place.
--
-- ── What this migration does ────────────────────────────────────────
--
-- Postgres only streams changes for tables in a publication. Supabase
-- reads `supabase_realtime`, and a table missing from it is simply silent
-- — the client subscribes, receives nothing, and reports no error. So the
-- symptom of forgetting this file is "live sync doesn't work and nothing
-- says why", which is why the verification at the bottom is not optional.
--
-- ── Replica identity is deliberately left alone ─────────────────────
--
-- A DELETE broadcasts only the primary key unless the table is set to
-- `replica identity full`, which makes every UPDATE write the entire old
-- row into the WAL as well.
--
-- We do not need it. The app finds a deleted section row by scanning the
-- rows it already holds in memory (see removeSectionRowById), which costs
-- one pass over data that is already there, once per deletion. Paying WAL
-- on every update for the rest of the system's life to avoid that would be
-- a bad trade — and this is the same database that had 10 GB of transfer
-- eaten by a retry loop two weeks ago.
--
-- ── RLS still applies ───────────────────────────────────────────────
--
-- Realtime respects row level security: a subscriber is sent only the
-- changes it could have selected. The policy on these tables is
-- `using (true)` for authenticated, so every member of staff sees every
-- case — the same as the rest of the app, by design. Nothing here widens
-- anyone's access; it only changes WHEN they find out.
--
-- Safe to re-run.
-- ---------------------------------------------------------------------

do $$
declare
  t text;
  wanted text[] := array[
    'matter',
    'matter_checklist_item',
    'activity',
    'matter_section_data',
    'matter_section_row',
    'contact'
  ];
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception
      'The supabase_realtime publication does not exist. Enable Realtime for this project first.';
  end if;

  foreach t in array wanted loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
      raise notice 'added %', t;
    else
      raise notice 'already published: %', t;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Verification.
--
-- A table missing here is silent at runtime — the app subscribes, no
-- events arrive, and nobody finds out until somebody complains again that
-- they cannot see a colleague's entry. So fail loudly now instead.
-- ---------------------------------------------------------------------
do $$
declare
  missing text[];
begin
  select array_agg(t) into missing
    from unnest(array[
      'matter', 'matter_checklist_item', 'activity',
      'matter_section_data', 'matter_section_row', 'contact'
    ]) as t
   where not exists (
     select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
   );

  if missing is not null then
    raise exception 'FAIL: not published, live sync will be silent for: %', missing;
  end if;
  raise notice 'OK: all six tables publish their changes';
end $$;

select
  tablename                                        as published_table,
  (select relreplident from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = t.tablename) as replica_identity
from pg_publication_tables t
where pubname = 'supabase_realtime' and schemaname = 'public'
order by tablename;
