-- The respondent's affirmative "I understand what I get back for what I give".
-- Separate from disclosure_level: that records WHICH rung they chose, this
-- records that they understood the ladder before choosing it. A choice made
-- without knowing aggregate-only forgoes named detail is not an informed one.
alter table benchmarking
  add column if not exists terms_acknowledged_at timestamptz,
  add column if not exists terms_acknowledged_by uuid references profiles(id);

comment on column benchmarking.terms_acknowledged_at is
  'When the respondent confirmed they understood the results ladder (non-participant -> nothing, aggregate contributor -> aggregate, full participant -> full). Null means not yet acknowledged.';
