-- =====================================================================
-- 005 — RELATED CASES
--
-- The firm's rail has a Related Cases tab: other matters connected to
-- this one. Same incident with two injured passengers, a client with a
-- second claim, a companion suit.
--
-- A real table rather than a list of ids in JSONB, for two reasons that
-- both bite later:
--
--   1. REFERENTIAL INTEGRITY. `on delete cascade` means deleting a
--      matter cannot leave a dangling link pointing at nothing. A JSONB
--      array would quietly keep the id and render a broken row.
--   2. IT IS TRAVERSABLE BOTH WAYS. "What is related to this matter"
--      must return links made from either end, without scanning every
--      row of every other matter's section data.
-- =====================================================================

do $$ begin
  create type relation_kind as enum
    ('Same Incident', 'Same Client', 'Companion Suit', 'Subrogation', 'Related');
exception when duplicate_object then null; end $$;

create table if not exists matter_relation (
  id          uuid primary key default gen_random_uuid(),
  from_id     uuid not null references matter(id) on delete cascade,
  to_id       uuid not null references matter(id) on delete cascade,
  kind        relation_kind not null default 'Related',
  note        text,
  created_at  timestamptz not null default now(),
  created_by  uuid references profile(id),

  -- A matter related to itself is always a mistake, and it renders as an
  -- infinite loop of a case linking to itself in the UI.
  constraint no_self_relation check (from_id <> to_id)
);

-- The relation is UNDIRECTED in meaning: "A is related to B" and "B is
-- related to A" are the same fact, so storing both would show two rows
-- on each case. `least`/`greatest` normalise the pair so the unique
-- index catches a duplicate entered from either end.
create unique index if not exists matter_relation_pair_uq
  on matter_relation (least(from_id, to_id), greatest(from_id, to_id));

create index if not exists matter_relation_from on matter_relation (from_id);
create index if not exists matter_relation_to   on matter_relation (to_id);

alter table matter_relation enable row level security;
do $$ begin
  create policy staff_all on matter_relation for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------
do $$
declare a uuid; b uuid;
begin
  insert into matter (client_name) values ('__probe_a__') returning id into a;
  insert into matter (client_name) values ('__probe_b__') returning id into b;

  begin
    insert into matter_relation (from_id, to_id) values (a, a);
    raise exception 'FAIL: a matter was related to itself';
  exception when check_violation then
    raise notice 'OK: self-relation refused';
  end;

  insert into matter_relation (from_id, to_id) values (a, b);
  begin
    -- The same fact entered from the other end must be refused.
    insert into matter_relation (from_id, to_id) values (b, a);
    raise exception 'FAIL: the same relation was accepted twice';
  exception when unique_violation then
    raise notice 'OK: a duplicate pair is refused from either direction';
  end;

  delete from matter where id in (a, b);
  raise notice 'OK: 005_sections.sql applied';
end $$;
