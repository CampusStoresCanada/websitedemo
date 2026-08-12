-- Records the province the prospect selected at checkout, so the tax rate
-- applied to their membership line item (origin-based, per their own
-- province — see resolveMembershipStripeTaxRateId in
-- lib/actions/prospective-booth-checkout.ts) has an audit trail independent
-- of whatever province they later enter on the full application form.

alter table public.prospective_booth_payments
  add column if not exists province text;
