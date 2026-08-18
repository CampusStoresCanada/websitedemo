-- Real link between contacts (org-scoped directory record) and profiles
-- (1:1 with auth.users, the actual login). Previously joined only by
-- matching email strings at runtime -- the same soft-linking pattern that
-- caused the contacts/people drift (see e5b299d). Nullable and NOT unique:
-- the same real person legitimately has one contacts row per org they
-- belong to, and all of those rows can correctly point at the same profile.
alter table contacts add column if not exists profile_id uuid references profiles(id);
create index if not exists contacts_profile_id_idx on contacts(profile_id);

comment on column contacts.profile_id is 'The login (profiles/auth.users) this contact corresponds to, when they have one. Written by lib/identity/lifecycle.ts''s linkUserToPerson() at login-provisioning time. NULL for contacts with no login, and deliberately left NULL for a small number of pre-existing shared-inbox cases where email alone cannot distinguish which of several distinct people the login belongs to -- see project memory / 2026-08-17 backfill.';
