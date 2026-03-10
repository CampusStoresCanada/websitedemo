-- Backfill missing billing policy keys across existing policy sets.
-- Idempotent: inserts only keys that are missing per policy_set.

with defaults as (
  select *
  from (
    values
      ('billing.proration_rules', 'billing', 'Proration Cutoffs', 'Proration discount rules by month/day cutoff.', 'json',
        '[{"after_month_day":"02-01","discount_pct":50},{"after_month_day":"06-01","discount_pct":75}]'::jsonb, true, 10),
      ('billing.membership_tiers', 'billing', 'Membership Pricing by FTE', 'Tiered annual pricing by FTE band.', 'json',
        '[{"max_fte":2500,"price":420},{"max_fte":5000,"price":525},{"max_fte":10000,"price":735},{"max_fte":20000,"price":895},{"max_fte":null,"price":1000}]'::jsonb, true, 20),
      ('billing.partnership_rate', 'billing', 'Partnership Flat Rate', 'Annual flat rate for vendor partners.', 'decimal',
        '600'::jsonb, true, 30),
      ('billing.downgrade_policy', 'billing', 'Downgrade Timing', 'When downgrades take effect.', 'string',
        '"next_cycle"'::jsonb, false, 40),
      ('billing.currency', 'billing', 'Billing Currency', 'Currency code used for billing.', 'string',
        '"CAD"'::jsonb, false, 50),
      ('billing.pricing_mode', 'billing', 'Pricing Model', 'Pricing algorithm mode.', 'string',
        '"FTE_BUCKETS"'::jsonb, true, 60),
      ('billing.formula_config', 'billing', 'Formula Config', 'Config for LINEAR_FORMULA mode.', 'json',
        '{"base":300,"multiplier":0.08,"min_price":300,"max_price":2500,"rounding":"nearest_dollar"}'::jsonb, true, 70),
      ('billing.metric_key', 'billing', 'Pricing Metric Key', 'Data field path used for metric-driven pricing.', 'string',
        '"organizations.fte"'::jsonb, true, 80),
      ('billing.metric_allowlist', 'billing', 'Allowed Metric Keys', 'Allowed numeric metric fields for billing.metric_key.', 'string_array',
        '["organizations.fte"]'::jsonb, true, 90),
      ('billing.fallback_price', 'billing', 'Fallback Price', 'Price used when required metric data is missing.', 'decimal',
        '1000'::jsonb, true, 100),
      ('billing.fallback_behavior', 'billing', 'Fallback Behavior', 'How pricing behaves when metric data is missing.', 'string',
        '"use_fallback_price"'::jsonb, true, 110),
      ('billing.rounding_rule', 'billing', 'Rounding Rule', 'Rounding behavior for computed prices.', 'string',
        '"nearest_dollar"'::jsonb, true, 120),
      ('billing.manual_override_allowed', 'billing', 'Manual Override Allowed', 'Allow admins to manually set computed prices.', 'boolean',
        'true'::jsonb, true, 130),
      ('billing.override_persistence', 'billing', 'Override Persistence', 'How long manual overrides remain effective.', 'string',
        '"cycle_only"'::jsonb, true, 140)
  ) as t(policy_key, category, label, description, value_type, value_json, is_high_risk, display_order)
)
insert into public.policy_values (
  policy_set_id,
  key,
  category,
  label,
  description,
  type,
  value_json,
  validation_schema,
  is_high_risk,
  display_order
)
select
  ps.id,
  d.policy_key,
  d.category,
  d.label,
  d.description,
  d.value_type,
  d.value_json,
  null,
  d.is_high_risk,
  d.display_order
from public.policy_sets ps
cross join defaults d
where not exists (
  select 1
  from public.policy_values pv
  where pv.policy_set_id = ps.id
    and pv.key = d.policy_key
);
