-- An access window that brackets the term, because they are not the same thing.
--
-- A director's TERM is a governance fact: it decides quorum, voting and the
-- four-term cap. Their ACCESS is an operational one: the board mailing list,
-- the board space, the papers. Collapsing the two is how somebody loses the
-- login they still need, or keeps one they should not — which
-- lib/elections/transition.ts already said in its header and then only half
-- built, as a one-time add/remove rather than a state anything could read.
--
-- The two real cases:
--   incoming — acclaimed in October, term starts 2027-01-01, and the Executive
--              Director invites them to the board well before either. They are
--              NOT a director yet and must not count toward the floor of seven.
--   outgoing — term ends 2027-01-01 and they stay through the conference after
--              the AGM. Still reachable, no longer voting.
--
-- ⛔ NULL means "same as the term", never "no access". Every one of the 56 rows
-- on this table predates these columns and must keep behaving exactly as it did,
-- so every reader coalesces: access_from ?? term_start, access_until ?? term_end.
--
-- ⚠️ access_until is EXCLUSIVE, matching term_end and every other date here.
--
-- Set per transition, not per person: applyBoardTransition stamps one date
-- across the whole incoming or outgoing cohort, from the choice already offered
-- on the board transition panel (the AGM, after the conference, or a custom
-- date). A per-person value is possible but is not what the controls write.
alter table governance_role_assignments
  add column if not exists access_from date,
  add column if not exists access_until date;

comment on column governance_role_assignments.access_from is
  'When board access begins, if earlier or later than term_start. NULL means term_start. Set across an incoming cohort by the board transition, so somebody acclaimed in the autumn can be let into the board space before their term starts in January.';

comment on column governance_role_assignments.access_until is
  'When board access ends, EXCLUSIVE, if later than term_end. NULL means term_end. Set across an outgoing cohort by the board transition, so a director whose term ended at the AGM keeps the mailing list through the conference that follows it.';
