-- Narrow the drain's read on organizations to the columns the engine uses.
--
-- A table-level SELECT handed it stripe_customer_id, quickbooks_customer_id,
-- token, notion_properties and every sync field — none of which the scorer
-- opens. The list below is exactly MatchProfileInput (lib/match/profile.ts)
-- plus the two lifecycle flags the runner filters on.
--
-- Same principle as the column-scoped UPDATE on signal_inbox: the credential
-- should be boring to steal.

revoke select on public.organizations from csc_drain;

grant select (
  id, name, type, primary_category, certifications, is_cancoll_member,
  province, company_description, website_summary, fte, institution_type,
  procurement_info, archived_at, is_test
) on public.organizations to csc_drain;
