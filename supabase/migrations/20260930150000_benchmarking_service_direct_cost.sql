-- What a service costs to deliver.
--
-- The survey asked what printing, lockers and gown rental EARN and never asked
-- what they cost, so a print desk turning over $40k on $35k of toner, paper and
-- a machine lease looked identical to one earning the same at almost no
-- marginal cost. Those are not the same business and the report could not tell
-- them apart.
--
-- ⛔ The flag is the important half. For most stores the toner is already
-- inside "Store and business supplies" and the lease inside "Depreciation", so
-- adding the direct cost to total expenses would count it twice. Defaults to
-- true (already counted) because that is the common case, and a store that
-- keeps a service's costs outside its ordinary expense lines says so.

alter table public.benchmarking_other_income
  add column if not exists direct_cost numeric,
  add column if not exists direct_cost_in_expenses boolean not null default true;

comment on column public.benchmarking_other_income.direct_cost is
  'What it costs to deliver this income. Used for the service''s own margin.';
comment on column public.benchmarking_other_income.direct_cost_in_expenses is
  'True when the cost is already inside the Expenses section, so the statement must not add it again.';
