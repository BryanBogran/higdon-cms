-- =====================================================================
-- Correction: Postgres does NOT reject '3/1/24'.
--
-- The default DateStyle is 'ISO, MDY', so '3/1/24' is a perfectly valid
-- date literal meaning 2024-03-01. Worse, Postgres is heuristic: given
-- '13/1/24' it notices 13 cannot be a month and silently reads it as
-- 13 January instead. So a `date` column is not, on its own, protection
-- against ambiguous spreadsheet dates -- it will accept them and pick an
-- interpretation without telling anyone.
--
-- What a date column DOES still reject, and these are worth having:
--   'TBD', 'n/a', ''      -> invalid_datetime_format
--   '2024-02-30'          -> datetime_field_overflow (Feb 30 is not real)
--   '1776-01-01'          -> our range CHECK
--   sol before doa        -> sol_after_doa
--
-- The disambiguation problem is not one any database can solve: '3/1/24'
-- is genuinely ambiguous and only a human knows which the firm meant.
-- So the guard has to live at the INPUT boundary, which is what this
-- function is for. The UI already only sends ISO (an <input type="date">
-- cannot produce anything else); the IMPORTER must use this rather than
-- casting raw cells.
-- =====================================================================

create or replace function parse_iso_date(raw text)
returns date
language plpgsql
immutable
as $$
begin
  if raw is null then return null; end if;

  raw := btrim(raw);
  if raw = '' then return null; end if;

  -- ISO and nothing else. No MDY, no DMY, no two-digit years, no
  -- heuristics -- if it is not unambiguous, it is not a date yet.
  if raw !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception
      'Ambiguous or non-ISO date: %. Dates must arrive as YYYY-MM-DD; '
      'resolve the format before import rather than letting Postgres guess.', raw
      using errcode = 'invalid_datetime_format';
  end if;

  -- Still let the real calendar reject Feb 30 and friends.
  return raw::date;
end $$;

comment on function parse_iso_date(text) is
  'Strict ISO-only date parser for the import path. A plain ::date cast '
  'accepts MDY strings like 3/1/24 and guesses; this refuses instead.';
