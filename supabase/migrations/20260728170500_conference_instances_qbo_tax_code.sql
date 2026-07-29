-- Conference commerce tax is one flat GST/HST code per conference — taxed by
-- where the conference is physically held, uniformly across every booth/
-- registration/sponsorship sale, never varying by item category. Same
-- "one setting per conference, entered by an admin" shape as the existing
-- tax_jurisdiction/tax_rate_pct/stripe_tax_rate_id columns (used for Stripe's
-- own tax calculation) — this is the QuickBooks-side equivalent.
alter table public.conference_instances
  add column if not exists qbo_tax_code_ref text;
