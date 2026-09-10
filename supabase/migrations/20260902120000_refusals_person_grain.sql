-- A DELEGATE'S OWN BLACKOUT.
--
-- Same table, not a second system. A refusal is "I will not sit in a room with
-- them"; who is saying it — a company or one of its people — is the SUBJECT of
-- that statement, not a different kind of statement. `declaring_contact_id`
-- null means the org is the subject, set means a person is, which is exactly
-- the convention `conference_top_choices` and `match_edges.subject_contact_id`
-- already use, so the engine reads it without translation.
--
-- ⛔ NOT symmetrical the way an org refusal is. A store refusing a vendor blacks
-- out the pair in both directions — either side may fire the other. One buyer
-- refusing a vendor blacks out THAT BUYER only: their colleague may still want
-- the meeting, the store has not refused anything, and the vendor certainly has
-- not refused the store. Mirroring a person's row onto their company would let
-- one person quietly speak for everyone they work with.
alter table public.org_meeting_refusals
  add column if not exists declaring_contact_id uuid
    references public.contacts(id) on delete cascade;

comment on column public.org_meeting_refusals.declaring_contact_id is
  'Whose refusal this is. Null = the organization''s own (exhibitor grain); set = one delegate''s. Distinct from declared_by_contact_id, which is merely who typed it.';

-- ⛔ The old unique pair index cannot survive person rows. It was
-- (declaring_org_id, refused_org_id) WHERE retired_at IS NULL, so two
-- colleagues at one store refusing the same vendor would collide with each
-- other AND with their own org's row. Split it by grain.
drop index if exists public.org_meeting_refusals_active_pair;

create unique index if not exists org_meeting_refusals_active_org_pair
  on public.org_meeting_refusals (declaring_org_id, refused_org_id)
  where retired_at is null and declaring_contact_id is null;

create unique index if not exists org_meeting_refusals_active_person_pair
  on public.org_meeting_refusals (declaring_contact_id, refused_org_id)
  where retired_at is null and declaring_contact_id is not null;

create index if not exists org_meeting_refusals_declaring_contact_active
  on public.org_meeting_refusals (declaring_contact_id)
  where retired_at is null and declaring_contact_id is not null;
