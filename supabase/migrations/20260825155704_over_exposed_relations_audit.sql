-- Widen the read-exposure audit, and drop one inert grant.
--
-- anon_readable_tables() only ever looked at `anon`. capability_contributions
-- was exposed to `authenticated`, through a VIEW that ran with its owner's
-- rights — so the audit sailed straight past it, the same way db_access_drift()
-- sailed past the anon read problem by only examining writes.
--
-- over_exposed_relations() covers the three shapes that actually leak reads:
--
--   rls_off             a table with RLS disabled and a grant to anon or
--                       authenticated. Every row, to everyone holding that key.
--   permissive_policy   RLS on, but a USING (true) SELECT policy covering anon,
--                       authenticated or PUBLIC, plus the matching grant.
--   owner_rights_view   a view whose security_invoker is not on. It executes as
--                       its owner, so RLS on the tables underneath does not
--                       apply to the caller at all. This is what happened.
--
-- It also reports `traps` separately: a SELECT grant with no policy that admits
-- the role. Those return zero rows today and leak nothing, but they are one
-- permissive policy away from doing so, and the zero-rows-with-no-error shape
-- is the same one that hides silent write failures.
--
-- Nothing is dropped quietly. Deliberately-public relations are returned under
-- `acknowledged` rather than filtered out, so the list of what we have decided
-- not to care about stays visible next to the list of what we have not reviewed.

drop function if exists public.anon_readable_tables();

create or replace function public.over_exposed_relations()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
with reader_grants as (
  select table_name, grantee
  from information_schema.role_table_grants
  where table_schema = 'public'
    and privilege_type = 'SELECT'
    and grantee in ('anon', 'authenticated')
),
permissive as (
  -- A SELECT/ALL policy with a `true` qualifier, covering one of our roles.
  -- polroles '{0}' is PUBLIC, which covers both anon and authenticated.
  select c.relname as relname, pol.polname, r.grantee
  from pg_policy pol
  join pg_class c on c.oid = pol.polrelid
  join reader_grants r on r.table_name = c.relname
  where c.relnamespace = 'public'::regnamespace
    and pol.polcmd in ('r', '*')
    and coalesce(pg_get_expr(pol.polqual, pol.polrelid), 'true') = 'true'
    and (
      pol.polroles = '{0}'
      or r.grantee in (select rolname from pg_roles where oid = any (pol.polroles))
    )
),
findings as (
  -- 1. RLS switched off entirely
  select c.relname, 'table' as relkind, 'rls_off' as problem,
         r.grantee, null::text as detail
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  join reader_grants r on r.table_name = c.relname
  where c.relkind = 'r' and not c.relrowsecurity

  union all

  -- 2. RLS on, but the policy lets everyone through
  select p.relname, 'table', 'permissive_policy', p.grantee, p.polname
  from permissive p

  union all

  -- 3. View executing with its owner's rights, bypassing RLS underneath
  select c.relname, 'view', 'owner_rights_view', r.grantee,
         pg_get_userbyid(c.relowner)
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  join reader_grants r on r.table_name = c.relname
  where c.relkind = 'v'
    and (c.reloptions is null
         or not ('security_invoker=on' = any (c.reloptions)))
),
traps as (
  -- Grant held, but no policy admits that role: zero rows, no error, today.
  select r.table_name as relname, r.grantee
  from reader_grants r
  join pg_class c on c.relname = r.table_name
   and c.relnamespace = 'public'::regnamespace
  where c.relkind = 'r'
    and c.relrowsecurity
    and not exists (
      select 1 from pg_policy pol
      where pol.polrelid = c.oid
        and pol.polcmd in ('r', '*')
        and (pol.polroles = '{0}'
             or r.grantee in (select rolname from pg_roles
                              where oid = any (pol.polroles)))
    )
),
-- Reviewed and accepted. Listed, never silently skipped.
allowed(relname, why) as (
  values
    ('organizations',  'Public member and partner directory.'),
    ('brand_colors',   'Public brand assets.'),
    ('profiles',       'display_name/avatar/global_role to signed-in members; the community directory depends on it.'),
    -- Title, status and the open/close dates. Members are supposed to see this:
    -- knowing whether the survey is open, and when it closes, is the whole point
    -- of the landing page. It carries no store's answers — those live in
    -- `benchmarking`, which is scoped per org.
    ('benchmarking_surveys', 'Survey title, status and dates. Members need to see when the survey opens and closes.')
)
select jsonb_build_object(
  'exposed', coalesce((
    select jsonb_agg(jsonb_build_object(
             'relation', f.relname,
             'kind',     f.relkind,
             'problem',  f.problem,
             'exposed_to', f.grantee,
             'detail',   f.detail,
             -- anon means anyone on the internet; authenticated means any of
             -- the several hundred people who hold a login.
             'severity', case when f.grantee = 'anon' then 'critical'
                              else 'warning' end)
           order by (f.grantee = 'anon') desc, f.relname)
    from findings f
    where f.relname not in (select relname from allowed)
  ), '[]'::jsonb),
  'traps', coalesce((
    select jsonb_agg(distinct jsonb_build_object(
             'relation', t.relname, 'grantee', t.grantee))
    from traps t
    where t.relname not in (select relname from allowed)
  ), '[]'::jsonb),
  'acknowledged', coalesce((
    select jsonb_agg(jsonb_build_object('relation', a.relname, 'why', a.why)
           order by a.relname)
    from allowed a
    where a.relname in (select relname from findings)
  ), '[]'::jsonb)
);
$function$;

comment on function public.over_exposed_relations() is
  'Read-exposure audit: RLS off, permissive policies, and owner-rights views, for anon and authenticated. Supersedes anon_readable_tables(), which only checked anon.';

-- benchmarking_surveys: anon holds SELECT but no policy admits it, so the grant
-- returns zero rows and leaks nothing today. Removing it because the app never
-- reads this table anonymously — /benchmarking returns an empty survey list when
-- logged out — and an unused grant is one permissive policy away from a leak.
revoke select on public.benchmarking_surveys from anon;
