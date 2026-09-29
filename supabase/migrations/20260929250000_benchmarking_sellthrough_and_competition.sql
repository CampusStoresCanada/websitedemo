-- §3 sell-through, §10 the share booked elsewhere, §1 the local market.
--
-- Sell-through is physical only, and says so in the column comment as well as
-- the label: digital and Inclusive Access have no sell-through in any sense
-- that compares to a shelf of print, and one number covering both is the kind
-- of figure nobody trusts and everybody quotes.

alter table public.benchmarking
  add column if not exists cm_sell_through_pct numeric,
  add column if not exists ia_ea_booked_outside_pct numeric,
  add column if not exists competing_stores_count integer,
  add column if not exists competing_stores_notes text;

comment on column public.benchmarking.cm_sell_through_pct is
  'Physical course materials only. Digital and IA have no sell-through in any comparable sense.';
comment on column public.benchmarking.ia_ea_booked_outside_pct is
  'Share of the IA/EA programme booked through something that is not the bookstore.';
