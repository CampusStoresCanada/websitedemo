-- "Sales per square foot" is four questions, not one, and all four are worth
-- comparing: retail floor (how hard the selling space works), warehouse (how
-- much stock backs each selling foot), office (overhead carried), and total
-- (space the institution gives the store per dollar).
--
-- No extra burden on a store: they already report the four components in the
-- Square Footage Breakdown. This is arithmetic we do, not arithmetic we ask for.
alter table computed_metrics
  add column if not exists sales_per_sqft_total numeric,
  add column if not exists sales_per_sqft_storage numeric,
  add column if not exists sales_per_sqft_office numeric;

comment on column computed_metrics.sales_per_sqft is
  'Total revenue per square foot of SELLING floor (sqft_salesfloor).';
comment on column computed_metrics.sales_per_sqft_total is
  'Total revenue per square foot of everything the store occupies.';
