-- When we last asked this person to make their listing decision.
--
-- Kept on the contact rather than in a log table because the question is
-- per (person, org) and only the most recent ask matters: "who still needs
-- asking" is `directory_visibility is null and (asked_at is null or asked_at
-- < cutoff)`. A log would answer the same question with a join and invite
-- double-sends when it drifted.
alter table contacts
  add column if not exists directory_visibility_asked_at timestamptz;

comment on column contacts.directory_visibility_asked_at is
  'Last time this person was asked to choose their listing visibility. NULL = '
  'never asked. Used to avoid re-asking people who have already been emailed, '
  'and to tell "silent" apart from "never contacted".';

create index if not exists idx_contacts_visibility_pending
  on contacts(directory_visibility_asked_at)
  where directory_visibility is null and archived_at is null;
