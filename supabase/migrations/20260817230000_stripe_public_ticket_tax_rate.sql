-- Event ticket checkouts applied no tax_rates at all while their QuickBooks
-- receipts booked tax, so Stripe under-collected on every paid ticket. The
-- QBO side already had a flat rate for buyers with no organization
-- (qbo_tax_code_public_ticket); this is its Stripe counterpart, seeded to the
-- matching rate object so the two halves agree from the outset.
--
-- Buyers who DO have an org are taxed at that org's province on both sides
-- and don't use this setting.

insert into public.app_settings (key, value)
values ('stripe_tax_rate_id_public_ticket', 'txr_1FHCJyCZmKhS0SHG9YGQ6rgn')
on conflict (key) do nothing;
