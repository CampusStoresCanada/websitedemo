-- Document presentation_mode on the profiles preferences bag.
--
-- Comment-only: the column already exists (20260825180000_profiles_preferences)
-- and jsonb needs no migration to carry another key. This is here so the next
-- person reading the schema finds out what writes to it, rather than guessing
-- from a stray string in a jsonb column.
--
-- presentation_mode is a staff-only display setting: while it is set, the
-- account's viewerLevel is clamped to the named audience so a screen share
-- renders as a member/partner/visitor sees it. It never changes what the
-- account may DO — capability is resolved from profiles.global_role, which
-- this does not touch. See lib/presentation/mode.ts.
comment on column public.profiles.preferences is
  'Per-account UI preferences. Keys: circle_badge_paused (bool) — suppresses the '
  'header Circle notification poll for this account; presentation_mode '
  '(''member''|''partner''|''public'') — staff-only, clamps this account''s '
  'viewerLevel to that audience for screen sharing (display only, never capability).';
