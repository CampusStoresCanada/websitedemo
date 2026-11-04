-- The travel bursary request points at a registration, carries its hotel
-- nights, and records when CSC booked a prepaid trip.
--
-- Steve, 2026-11-02:
--   * "They fill in the request and this becomes a seat that they can swap
--     people into." Not a new seat type: a designation on one of the school's
--     registration seats. The supported delegate is whoever holds that seat, so
--     a swap on the org page (Unassign, then assign) moves the support with it.
--     Changes allowed until January 17, 2027 (MOU 8.7, the Terms).
--   * Hotel: $185 a night plus 19.78% room tax. Three nights, or four when the
--     delegate can't get home to campus before midnight local time on
--     Thursday, February 4. At most $886.37 (the Hilton's own 4-night total).
--     Stored as rate and tax, not $221.59 a night: 4 x $221.59 is $886.36, a
--     cent under the real bill, which the cap would refuse. Six schools get four (research,
--     drafts/bursary-hotel-nights-2027.md); staff can change any one.
--   * "Something clearly should tell us that they need us to pay in advance."
--     A prepay request waits in the War Room until staff mark it booked.
--
-- Only columns and settings: nothing here changes what the deployed site does.
-- Applied 2026-11-03.

alter table public.conference_bursary_applications
  add column if not exists delegate_seat_id uuid references public.entity_balance_seats(id) on delete set null,
  add column if not exists hotel_nights smallint check (hotel_nights between 1 and 4),
  add column if not exists prepay_booked_at timestamptz,
  add column if not exists prepay_booked_by uuid references auth.users(id) on delete set null;

alter table public.conference_instances
  -- Exclusive instant, same convention as bursary_request_closes_at.
  add column if not exists bursary_designation_closes_at timestamptz,
  -- Before tax, and the room tax in basis points.
  add column if not exists bursary_hotel_night_cents integer check (bursary_hotel_night_cents > 0),
  add column if not exists bursary_hotel_tax_bps integer check (bursary_hotel_tax_bps >= 0),
  add column if not exists bursary_four_night_org_ids uuid[] not null default '{}';

-- 2027-01-18T08:00Z is the end of January 17 in every Canadian zone.
update public.conference_instances
set bursary_designation_closes_at = '2027-01-18 08:00:00+00',
    bursary_hotel_night_cents = 18500,
    bursary_hotel_tax_bps = 1978,
    bursary_four_night_org_ids = array[
      'da7d375a-ce6a-4043-8482-659b0652ebda', -- Keyano College
      '15fa4131-6dbe-426d-adff-c0c633ea3e9f', -- University College of the North
      '43c7b884-da6c-46d6-ab8d-44bcc5c4979a', -- University of New Brunswick (Saint John)
      'a4177a45-b350-4077-b1e9-f9da8abade7b', -- University of Victoria
      '613c169d-ac33-4716-ba93-476f8612b381', -- Camosun College
      '83f285a8-1989-4ce1-add2-8c0b231090dd'  -- Royal Roads University
    ]::uuid[]
where id = '7e650b08-51d1-4573-a332-7d6b6fbc50bd';

update public.conference_bursary_applications a
set hotel_nights = case when a.organization_id = any (c.bursary_four_night_org_ids) then 4 else 3 end
from public.conference_instances c
where c.id = a.conference_id
  and a.conference_id = '7e650b08-51d1-4573-a332-7d6b6fbc50bd'
  and a.hotel_nights is null;

-- The program's hotel ceiling is the four-night maximum; each claim's own cap
-- is its request's nights at the rate plus tax (lib/expenses/sources.ts).
update public.expense_program_categories c
set cap_cents = 88637
from public.expense_programs p
where p.id = c.program_id and p.slug = 'travel-bursary-2027' and c.key = 'hotel';

-- A person task can be scoped to people holding a designated seat, not only
-- to a catalogue entity. Read by loadPersonalTasks.
alter table public.conference_checklist_tasks
  add column if not exists scope_designation text
    check (scope_designation in ('bursary_delegate'));
