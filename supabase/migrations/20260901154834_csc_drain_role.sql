-- The match engine's drain credential.
--
-- ⛔ Created WITHOUT a password on purpose. The role exists and holds exactly the
-- privileges it needs, but cannot authenticate until a password is set from the
-- operator's own machine — so the secret is generated locally, goes straight
-- into the Keychain, and never passes through a transcript, a tool call, or a
-- file that a backup would replicate.
--
--   PW=$(openssl rand -base64 32)
--   security add-generic-password -a csc-drain -s csc-match-engine -w "$PW"
--   psql "$ADMIN_URL" -c "alter role csc_drain with password '$PW'"
--   unset PW
--
-- ⛔ Never SUPABASE_SERVICE_ROLE_KEY. Service role bypasses RLS on every table to
-- do a job that needs six. Stolen, this role yields roughly one drain interval
-- of search strings.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'csc_drain') then
    create role csc_drain with login noinherit;
  end if;
end $$;

grant usage on schema public to csc_drain;

-- Take from the queue and remove what has been copied. UPDATE is column-scoped:
-- the drain marks its own claim and nothing else, so a compromised drain cannot
-- rewrite the acts themselves before they are read.
grant select                          on public.signal_inbox        to csc_drain;
grant update (claimed_at, claimed_by) on public.signal_inbox        to csc_drain;
grant delete                          on public.signal_inbox        to csc_drain;
grant insert                          on public.signal_inbox_drains to csc_drain;

-- Write derived output. Org-grained, carries no person.
grant select, insert, update, delete on public.signal_term_rollup     to csc_drain;
grant select, insert, update, delete on public.signal_affinity_rollup to csc_drain;
grant select, insert, update         on public.match_runs             to csc_drain;
grant select, insert, update, delete on public.match_edges            to csc_drain;

-- Read what it scores against.
--
-- ⚠️ NOT contacts. The engine reads organizations columns only
-- (lib/match/profile.ts — MatchProfileInput is entirely organizations), and
-- category_buyers holds the subcategory strings the scorer needs. Granting read
-- on 986 contact records for a job that never opens the table would be the
-- opposite of narrow.
-- ⚠️ Narrowed to specific columns by the next migration.
grant select on public.organizations to csc_drain;

-- ⚠️ A plain role does NOT bypass RLS, so the grants above would return zero rows
-- without a policy scoped to it. Policies rather than BYPASSRLS: that attribute
-- would recreate service_role under another name.
do $$
declare t text;
begin
  foreach t in array array['signal_inbox','signal_inbox_drains','signal_term_rollup',
                           'signal_affinity_rollup','match_runs','match_edges']
  loop
    if not exists (
      select 1 from pg_policies
      where schemaname='public' and tablename=t and policyname='csc_drain_all'
    ) then
      execute format(
        'create policy csc_drain_all on public.%I for all to csc_drain using (true) with check (true)', t
      );
    end if;
  end loop;
end $$;

comment on role csc_drain is
  'Match engine drain. Least privilege: claim/delete the signal inbox, write rollups and match output, read organizations. Password set out-of-band from the Keychain; never service_role.';
