-- ---------------------------------------------------------------------
-- 021 — a bar number on an attorney's contact card
--
-- The firm keeps opposing counsel, mediators and their own attorneys in
-- Contacts, and Filevine's Details tab carries a Bar Number. Ours had
-- nowhere to put one, so it was going in Notes or nowhere.
--
-- On `contact` rather than a separate table: it is one nullable text
-- field on a record that already exists, and a join for one column buys
-- nothing.
--
-- TEXT, not a number. A bar number is an identifier, not a quantity --
-- it can carry leading zeros, and no arithmetic is ever done on it.
-- Storing it as an integer would drop a leading zero silently and there
-- would be no way to tell afterwards.
--
-- No check constraint: the format is set by each state's bar, the firm
-- works across more than one, and refusing a number somebody is reading
-- off a filing is worse than accepting an odd-looking one.
--
-- Nullable, because 250-odd contacts have no bar number and most never
-- will.
--
-- Safe to re-run.
-- ---------------------------------------------------------------------

alter table contact add column if not exists bar_number text;

select
  count(*)                                              as contacts,
  count(bar_number) filter (where bar_number <> '')     as with_a_bar_number
from contact
where deleted_at is null;
