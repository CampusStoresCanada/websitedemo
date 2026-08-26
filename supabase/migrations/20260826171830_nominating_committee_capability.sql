-- The Nominating Committee, as a governance body with a capability.
--
-- By-Law Part V S2(a): the committee puts a slate to the members. Its default
-- membership is the President, the Past President and the Executive Director;
-- the board may appoint additional members.
--
-- Both halves resolve through ONE path: governance_role_assignments joined to
-- governance_role_capabilities. Officers get the capability derived from the
-- office they already hold, so it follows the chair rather than the person and
-- maintains itself across a board turnover. Appointed members get the SAME
-- capability through a `nominating_committee_member` assignment on this body,
-- with term dates that expire it and appointing_resolution recording why.
--
-- Deliberately NOT capability_grants. That table has no read path — neither
-- has_capability() nor current_capabilities() joins it, both resolving purely
-- through roles — so a grant issued there reports success and does nothing.
-- Confirmed by the Benchmarking thread 2026-08-26 against a live grant that
-- resolves false.

insert into public.governance_bodies (key, name, seat_count, min_seat_count, term_length_years, max_consecutive_terms)
values ('nominating_committee', 'Nominating Committee', null, null, null, null)
on conflict (key) do nothing;

-- Officers hold this ex officio. The contributions view joins on role_key
-- alone, so these resolve wherever the officer's seat sits.
insert into public.governance_role_capabilities (role_key, capability)
values
  ('president',           'elections.nominating_review'),
  ('past_president',      'elections.nominating_review'),
  ('executive_director',  'elections.nominating_review'),
  -- The appointment route: a non-office role_key, same capability.
  ('nominating_committee_member', 'elections.nominating_review')
on conflict do nothing;
