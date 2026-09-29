-- Who is filling this in, chosen from the people we already know at the store
-- rather than retyped into four free-text boxes every year.
--
-- respondent_name/title/email/phone stay: they are what a reviewer reads in
-- November, and they must survive the contact record being edited afterwards.
-- This adds the LINK, so we know which known person it is.
alter table benchmarking
  add column if not exists respondent_contact_id uuid references contacts(id) on delete set null,
  add column if not exists respondent_delegate_profile_id uuid references profiles(id) on delete set null,
  add column if not exists respondent_delegated_at timestamptz;

comment on column benchmarking.respondent_contact_id is
  'The known contact filling this in. Free-text respondent_* fields remain the record of what was stated at the time.';
comment on column benchmarking.respondent_delegate_profile_id is
  'Set when the store admin hands the survey to someone else and ticks "give them access". Scoped to THIS submission — deliberately not an org_admin promotion.';

create index if not exists benchmarking_delegate_idx
  on benchmarking (respondent_delegate_profile_id)
  where respondent_delegate_profile_id is not null;
