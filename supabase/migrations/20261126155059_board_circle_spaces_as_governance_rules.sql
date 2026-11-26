-- The board's two Circle spaces become `governance_role` rules, like the
-- mailing list already is.
--
-- ⛔ NO SCHEMA CHANGE. `20261027210000_group_rules_google_destination` already
-- allowed a governance_role rule with a circle_space destination: the kind
-- check lists it and the destination check only requires a `space_id` when the
-- destination is `circle_space`. Two lines of CODE were refusing it — the admin
-- validator ("A role rule keeps a Google group in step, not a Circle space")
-- and the hourly conference job, which pushed an error for any rule that was
-- neither a pass nor a survey rule. Both are fixed alongside this.
--
-- One rule per space, because `space_id` is UNIQUE, and for the reason the
-- original migration gives: "the job's add/remove ledger in circle_sync_queue
-- is keyed by space, so two rules on one space would each remove the other's
-- people."
--
-- ⚠️ `always_members` is left NULL. The Google rule declares three addresses
-- that stay on the list whatever the register says. The Circle spaces need no
-- equivalent, because removals here are limited to people the REGISTER says
-- hold or held the role — so staff, the Executive Director and the five Ghost
-- accounts are never candidates for removal and do not need declaring to be
-- safe. Declaring them would only mean trying to add people already there.
--
-- ⛔ These rules are NOT run by the hourly job. A governance_role rule runs
-- where the board changes — telling the winners — because the board turns over
-- once a year. See lib/circle/governance-space.ts.

insert into public.circle_space_rules
  (space_id, label, kind, destination, body_key, role_key, always_members)
values
  (1749439, 'Board Stuff (Circle)',      'governance_role', 'circle_space',
   'board_of_directors', 'director', null),
  (1654431, 'Board Group Chat (Circle)', 'governance_role', 'circle_space',
   'board_of_directors', 'director', null)
on conflict (space_id) do nothing;
