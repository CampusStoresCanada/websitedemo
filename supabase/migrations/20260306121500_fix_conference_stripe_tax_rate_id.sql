-- Fix drift where conference_instances.stripe_tax_rate_id is missing in a live project.
-- Safe to run multiple times.

alter table if exists public.conference_instances
  add column if not exists stripe_tax_rate_id text;

comment on column public.conference_instances.stripe_tax_rate_id is
  'Optional Stripe Tax Rate id (txr_...) used for checkout tax application for conference products.';

-- Ensure PostgREST schema cache sees the new column quickly.
notify pgrst, 'reload schema';
