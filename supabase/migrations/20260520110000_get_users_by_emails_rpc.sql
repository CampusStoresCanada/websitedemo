-- Allows server-side code to resolve auth.users by email list.
-- SECURITY DEFINER runs as the function owner (postgres) so it can
-- read auth.users regardless of the caller's role.
CREATE OR REPLACE FUNCTION public.get_users_by_emails(p_emails text[])
RETURNS TABLE(id uuid, email text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, email::text
  FROM auth.users
  WHERE lower(email) = ANY(SELECT lower(e) FROM unnest(p_emails) e);
$$;

-- Only service-role / postgres can call this (not anon/authenticated)
REVOKE ALL ON FUNCTION public.get_users_by_emails(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_users_by_emails(text[]) FROM authenticated;
REVOKE ALL ON FUNCTION public.get_users_by_emails(text[]) FROM anon;
