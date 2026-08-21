-- Sealing an election: destroying the link between a ballot and the institution
-- that cast it.
--
-- Done in ONE database function because a half-sealed election has no recovery.
-- The client cannot hold a transaction across several statements, and if the
-- copy into election_ballots_sealed succeeded while the delete of the linked
-- ballots failed, the result would be every vote recorded twice — once
-- anonymously and once attributably. That is worse than either outcome alone.
--
-- What survives: election_participation, written when each ballot was saved. It
-- holds which institutions voted and when, and nothing about their choices. What
-- goes: election_ballots and election_ballot_selections, the only rows that ever
-- joined an organization to a selection.
--
-- This is irreversible by design and cannot be undone by re-running anything.

create or replace function public.seal_election(p_election_id uuid)
returns table (sealed_count integer, participation_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_sealed integer;
  v_participation integer;
begin
  select status into v_status from elections where id = p_election_id for update;

  if v_status is null then
    raise exception 'Election % does not exist', p_election_id;
  end if;
  if v_status <> 'balloting' then
    raise exception 'Election is "%", not "balloting" — nothing to seal', v_status;
  end if;

  -- Randomised, so seal_order carries no trace of who voted when. Insertion
  -- order would otherwise reconstruct a rough chronology, and at 52 members a
  -- chronology plus a couple of "I voted this morning" remarks is attribution.
  insert into election_ballots_sealed (election_id, seal_order, abstain, selections)
  select
    p_election_id,
    row_number() over (order by random()),
    b.abstain,
    coalesce(
      (select array_agg(s.nomination_id) from election_ballot_selections s where s.ballot_id = b.id),
      '{}'::uuid[]
    )
  from election_ballots b
  where b.election_id = p_election_id;

  get diagnostics v_sealed = row_count;

  -- The attributable rows. Selections cascade from the ballots, but delete them
  -- explicitly so the intent is on the page rather than in a constraint.
  delete from election_ballot_selections
   where ballot_id in (select id from election_ballots where election_id = p_election_id);
  delete from election_ballots where election_id = p_election_id;

  select count(*) into v_participation
    from election_participation where election_id = p_election_id;

  update elections
     set status = 'sealed', sealed_at = now(), updated_at = now()
   where id = p_election_id;

  return query select v_sealed, v_participation;
end;
$$;

revoke all on function public.seal_election(uuid) from public, anon, authenticated;
grant execute on function public.seal_election(uuid) to service_role;

comment on function public.seal_election(uuid) is
  'Irreversibly anonymises an election''s ballots. Copies them into election_ballots_sealed in random order, then deletes election_ballots and their selections. election_participation survives as the roll of who voted. One transaction: a partial seal would record every vote twice, once anonymously and once attributably.';
