-- Revert the two contacts policies added earlier today.
--
-- They were the wrong pattern. This codebase authorizes contact reads at the
-- route/page guard and then reads with createAdminClient() — see
-- app/api/search/mentions/route.ts, which 401s anonymous callers and then
-- searches every contact for any signed-in user.
--
-- Adding RLS policies alongside that gives two competing sources of truth for
-- the same question. The recipient-confirmation page follows the house pattern
-- instead: guard first, then service-role read.

drop policy if exists contacts_recipient_confirm_read on public.contacts;
drop policy if exists contacts_admin_read on public.contacts;
