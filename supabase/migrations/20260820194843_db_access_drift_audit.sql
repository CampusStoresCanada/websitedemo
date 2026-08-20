-- A read-only inspector for the one thing Postgres will never tell us itself:
-- that a table's GRANTs and its RLS policies disagree about intent.
--
-- Postgres enforces both gates independently and has no concept of them being
-- inconsistent. So the two failure modes below are, to Postgres, entirely
-- correct behaviour:
--
--   GRANT but no policy  -> RLS matches zero rows. PostgREST reports success
--                           with error:null. The write silently vanishes.
--                           (This ate `organizations.procurement_info` writes
--                           from 2026-07-23 until 2026-08-20.)
--   Policy but no GRANT  -> denied at the GRANT gate with 42501. The policy is
--                           never evaluated — it reads as correct and has in
--                           fact never run once. (`benchmarking` was this.)
--
-- It also reports the public schema's DEFAULT privileges. Those currently grant
-- only service_role — Supabase ships anon + authenticated in that list too, and
-- no migration in this repo changes it, so it was altered outside the migration
-- path (console or SQL editor). That single deviation is why every table created
-- since is born with dead policies. Watching it is how we notice a console
-- change that the migrations can never show us.
--
-- STABLE + no writes. SECURITY DEFINER only so it can read pg_catalog and
-- information_schema; EXECUTE is revoked from PUBLIC/anon/authenticated per
-- 20260723193000, leaving service_role (i.e. createAdminClient) as the only
-- caller. search_path pinned per 20260723230000.

CREATE OR REPLACE FUNCTION public.db_access_drift()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
  WITH rls_tables AS (
    SELECT c.relname
    FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relkind = 'r'
      AND c.relrowsecurity
  ),
  -- What `authenticated` is allowed to do at the table level.
  grants AS (
    SELECT table_name,
           bool_or(privilege_type = 'INSERT') AS g_insert,
           bool_or(privilege_type = 'UPDATE') AS g_update,
           bool_or(privilege_type = 'DELETE') AS g_delete
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND grantee = 'authenticated'
    GROUP BY table_name
  ),
  -- What an RLS policy claims `authenticated` may do. `public` is included
  -- because that pseudo-role covers anon + authenticated.
  policies AS (
    SELECT tablename,
           bool_or(cmd IN ('INSERT', 'ALL')) AS p_insert,
           bool_or(cmd IN ('UPDATE', 'ALL')) AS p_update,
           bool_or(cmd IN ('DELETE', 'ALL')) AS p_delete
    FROM pg_policies
    WHERE schemaname = 'public'
      AND ('authenticated' = ANY(roles) OR 'public' = ANY(roles))
    GROUP BY tablename
  ),
  -- Genuinely open doors: the anon key is public by design, so an anon write
  -- GRANT plus an unconditional policy means anyone on the internet can write.
  anon_writable AS (
    SELECT DISTINCT pol.tablename AS relname
    FROM pg_policies pol
    JOIN information_schema.role_table_grants rg
      ON rg.table_schema = 'public'
     AND rg.table_name = pol.tablename
     AND rg.grantee = 'anon'
     AND rg.privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
    WHERE pol.schemaname = 'public'
      AND pol.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      AND ('anon' = ANY(pol.roles) OR 'public' = ANY(pol.roles))
      AND coalesce(pol.qual, 'true') = 'true'
      AND coalesce(pol.with_check, 'true') = 'true'
  ),
  compared AS (
    SELECT t.relname,
           (CASE WHEN coalesce(g.g_insert, false) AND NOT coalesce(p.p_insert, false) THEN 'INSERT ' ELSE '' END ||
            CASE WHEN coalesce(g.g_update, false) AND NOT coalesce(p.p_update, false) THEN 'UPDATE ' ELSE '' END ||
            CASE WHEN coalesce(g.g_delete, false) AND NOT coalesce(p.p_delete, false) THEN 'DELETE ' ELSE '' END
           ) AS silent_cmds,
           (CASE WHEN coalesce(p.p_insert, false) AND NOT coalesce(g.g_insert, false) THEN 'INSERT ' ELSE '' END ||
            CASE WHEN coalesce(p.p_update, false) AND NOT coalesce(g.g_update, false) THEN 'UPDATE ' ELSE '' END ||
            CASE WHEN coalesce(p.p_delete, false) AND NOT coalesce(g.g_delete, false) THEN 'DELETE ' ELSE '' END
           ) AS dead_cmds
    FROM rls_tables t
    LEFT JOIN grants g ON g.table_name = t.relname
    LEFT JOIN policies p ON p.tablename = t.relname
  )
  SELECT jsonb_build_object(
    'anon_writable',
      coalesce((SELECT jsonb_agg(relname ORDER BY relname) FROM anon_writable), '[]'::jsonb),
    'silent_noop',
      coalesce((SELECT jsonb_object_agg(relname, btrim(silent_cmds))
                FROM compared WHERE silent_cmds <> ''), '{}'::jsonb),
    'dead_policy',
      coalesce((SELECT jsonb_object_agg(relname, btrim(dead_cmds))
                FROM compared WHERE dead_cmds <> ''), '{}'::jsonb),
    'default_acl',
      coalesce((SELECT jsonb_agg(defaclacl::text ORDER BY defaclacl::text)
                FROM pg_default_acl WHERE defaclnamespace = 'public'::regnamespace), '[]'::jsonb)
  );
$$;

COMMENT ON FUNCTION public.db_access_drift() IS
  'Read-only audit of GRANT vs RLS-policy disagreement in the public schema, plus the schema default ACL. Consumed by the db_access_drift ops alert rule (lib/ops/alerts.ts). Service-role only.';

REVOKE EXECUTE ON FUNCTION public.db_access_drift() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.db_access_drift() TO service_role;
