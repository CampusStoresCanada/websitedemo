-- Add icon field to sponsor_tiers
-- Three options: award (medal), trophy, shield
-- Stored as a text key matching the SponsorTierIcon type

alter table public.sponsor_tiers
  add column if not exists icon text
    check (icon in ('award', 'trophy', 'shield'));

-- Default existing seeded tiers to sensible choices
update public.sponsor_tiers set icon = 'award'  where slug = 'platinum' and icon is null;
update public.sponsor_tiers set icon = 'trophy' where slug = 'gold'     and icon is null;
