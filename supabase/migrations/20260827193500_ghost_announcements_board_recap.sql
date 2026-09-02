-- Board recap announcements — a second kind on the existing ghost pipeline.
--
-- Butler Ghost drafts a recap when board minutes are saved; a human reviews it
-- and only then does it reach the private board space. See
-- docs/BOARD_RECAP_POST_MINT.md.
--
-- The recap differs from new_partner in one important way: its source tags are
-- CONSUMED from the minutes on save (parsed, moved here, removed from
-- minutes_html). That makes source_block the only surviving copy — see the
-- column comment below.

alter table public.ghost_announcements
  drop constraint ghost_announcements_kind_check,
  add constraint ghost_announcements_kind_check
    check (kind in ('new_partner', 'board_recap'));

-- The table-level unique (kind, organization_id) cannot express "one recap per
-- meeting", and organization_id is null for recaps. Replaced below by two
-- partial indexes — one per kind — which keep the same idempotency guarantee
-- each pipeline relies on.
alter table public.ghost_announcements
  drop constraint ghost_announcements_kind_organization_id_key;

alter table public.ghost_announcements
  alter column organization_id drop not null,
  add column if not exists meeting_id uuid references public.board_meetings(id) on delete cascade,
  add column if not exists source_block text;

create unique index if not exists ghost_announcements_new_partner_org_idx
  on public.ghost_announcements(organization_id)
  where kind = 'new_partner';

create unique index if not exists ghost_announcements_board_recap_meeting_idx
  on public.ghost_announcements(meeting_id)
  where kind = 'board_recap';

-- Each kind must carry the key its pipeline is idempotent on. Without this a
-- recap row with a null meeting_id would slip past the partial index above
-- (nulls are not indexed) and duplicate freely.
alter table public.ghost_announcements
  add constraint ghost_announcements_org_or_meeting_check
    check (
      (kind = 'new_partner' and organization_id is not null) or
      (kind = 'board_recap'  and meeting_id is not null)
    );

comment on column public.ghost_announcements.meeting_id is
  'The board meeting a board_recap was minted from. Null for new_partner rows.';

comment on column public.ghost_announcements.source_block is
  'The DECIDED/OUTSTANDING/NEXT MEETING block consumed from the minutes on save. The minutes no longer contain it — this is the ONLY copy. Regeneration re-parses this, never minutes_html.';
