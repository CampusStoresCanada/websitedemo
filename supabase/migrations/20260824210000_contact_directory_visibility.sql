-- A person's own decision about where they appear.
--
-- Replaces a two-state opt-OUT (`hidden`) with a three-state choice the person
-- makes for themselves. The org admin has no say in it: consent to be listed is
-- per person, and an admin override would just be opt-out wearing a label.
--
--   'hidden'  — nowhere except administrators
--   'members' — signed-in members and partners, and the PRINTED directory
--               (the book ships to member stores and is handed out at the show)
--   'public'  — the above, plus public pages
--
-- NULL means UNDECIDED, and the two surfaces treat that differently on purpose:
--   · website — falls back to the legacy `hidden` flag, so nothing moves for
--     the ~880 people who never opted out while they are being asked.
--   · print   — undecided is OUT. Paper cannot be corrected, so it requires an
--     explicit yes. Silence prints nobody.
alter table contacts
  add column if not exists directory_visibility text
    check (directory_visibility in ('hidden', 'members', 'public'));

comment on column contacts.directory_visibility is
  'Per-person listing choice: hidden | members | public. NULL = undecided. '
  'Print requires an explicit members/public. Website falls back to `hidden` '
  'while NULL. Set by the person themselves — never by an org admin.';

alter table contacts
  add column if not exists directory_visibility_set_at timestamptz;

comment on column contacts.directory_visibility_set_at is
  'When the person answered. NULL alongside a NULL choice means never asked or '
  'never answered — which is what the print gate keys on.';

-- Carry across the choices people have ALREADY made.
--
-- Only rows with a real address: every `@placeholder.com` stub is hidden = true
-- (100% of them), but that is a system flag on an auto-created row, not somebody
-- asking not to be listed. Migrating those would invent 14 opt-outs nobody made.
update contacts
set directory_visibility = 'hidden',
    directory_visibility_set_at = coalesce(updated_at, now())
where hidden = true
  and directory_visibility is null
  and coalesce(work_email, email) is not null
  and coalesce(work_email, email) not like '%@placeholder.com';

create index if not exists idx_contacts_directory_visibility
  on contacts(directory_visibility) where directory_visibility is not null;
