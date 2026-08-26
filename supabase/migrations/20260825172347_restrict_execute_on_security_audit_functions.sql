-- Both functions were created without an explicit EXECUTE grant, so Postgres
-- gave EXECUTE to PUBLIC by default — which includes anon, and the publishable
-- key ships in the browser bundle.
--
-- over_exposed_relations() is the worse of the two: it enumerates exactly which
-- relations have RLS off, which carry permissive policies, and which hold inert
-- grants. That is a map of where to push. db_access_drift() was correctly
-- restricted to service_role at creation; this brings the read-side audit in
-- line with it.
revoke execute on function public.over_exposed_relations() from public;
grant execute on function public.over_exposed_relations() to service_role;

-- has_capability() is called by five RLS policies (benchmarking, delta_flags,
-- benchmarking_field_reviews, benchmarking_recipients), which evaluate as the
-- calling role, so `authenticated` must keep EXECUTE. anon holds no grant on
-- any of those tables, so it never needs to evaluate them.
revoke execute on function public.has_capability(uuid, text, uuid) from public;
grant execute on function public.has_capability(uuid, text, uuid) to authenticated;
grant execute on function public.has_capability(uuid, text, uuid) to service_role;
