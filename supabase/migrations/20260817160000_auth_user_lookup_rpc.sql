-- Direct auth.users lookups, replacing paginated auth.admin.listUsers() walks.
--
-- Why: GoTrue's /admin/users pages with ORDER BY created_at DESC + LIMIT/OFFSET.
-- 563 of this project's 767 auth users share one identical created_at
-- (2026-02-05 20:36:24.389964+00, from a bulk import), so that sort is
-- ambiguous across the tie and each page request may order the tied rows
-- differently. Pages then overlap, and rows land on NO page at all: replaying
-- the 4-page walk returned 767 rows but only 597 distinct users, leaving 170
-- users permanently invisible to the lookup. Adding pages cannot fix it -- the
-- sort key itself is not unique.
--
-- The visible symptom was /forgot-password telling an existing member "Could
-- not set up your account" -- findUserByEmail reported "no account", so
-- initiateAccountRecovery took the first-time-setup branch and createUser then
-- failed with 422 email_exists. The same walk backs resolveOrgAdminEmails, so
-- invisible org_admins were also silently dropped from billing/renewal notices.
--
-- The email -> id direction already had a working RPC (get_users_by_emails),
-- so this adds only the missing id -> email direction.
--
-- SECURITY DEFINER because auth.users is not reachable through PostgREST.
-- Execute is granted to service_role ONLY -- every caller goes through
-- createAdminClient(). Never grant this to anon/authenticated: that would turn
-- it into an email-enumeration oracle.

create or replace function public.lookup_auth_user_emails(p_user_ids uuid[])
returns table (id uuid, email text)
language sql
security definer
set search_path = ''
stable
as $$
  select u.id, u.email::text
  from auth.users u
  where u.id = any(p_user_ids)
    and u.email is not null;
$$;

comment on function public.lookup_auth_user_emails(uuid[]) is
  'Resolve auth.users emails for a set of ids. Replaces paginated listUsers() walks, which silently skip rows when created_at ties span page boundaries. service_role only.';

revoke all on function public.lookup_auth_user_emails(uuid[]) from public;
revoke all on function public.lookup_auth_user_emails(uuid[]) from anon;
revoke all on function public.lookup_auth_user_emails(uuid[]) from authenticated;
grant execute on function public.lookup_auth_user_emails(uuid[]) to service_role;
