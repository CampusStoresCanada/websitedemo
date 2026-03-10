-- Add stripe_tax_rate_id to conference_instances
-- This stores the Stripe Tax Rate object ID (e.g. "txr_1ABC...") so checkout sessions
-- can attach the correct HST/GST rate based on the conference's physical location.
alter table public.conference_instances
  add column if not exists stripe_tax_rate_id text;

comment on column public.conference_instances.stripe_tax_rate_id is
  'Stripe Tax Rate object ID for the conference location tax jurisdiction (e.g. HST/GST). Created in Stripe dashboard or via API.';
