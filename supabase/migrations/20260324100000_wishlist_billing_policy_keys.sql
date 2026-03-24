-- Add policy-configurable wishlist billing retry cap and backoff.
-- Replaces hardcoded WISHLIST_MAX_RETRY_ATTEMPTS=3 and WISHLIST_RETRY_BACKOFF_MINUTES=60.
-- Idempotent: inserts only keys that are missing per policy_set.

with defaults as (
  select *
  from (
    values
      ('billing.wishlist_max_retry_attempts', 'billing', 'Wishlist Max Retry Attempts',
        'Maximum number of billing retry attempts for wishlist intents before marking as final failure.', 'integer',
        '3'::jsonb, '{"minimum":1,"maximum":10}'::jsonb, false, 150),
      ('billing.wishlist_retry_backoff_minutes', 'billing', 'Wishlist Retry Backoff (minutes)',
        'Minimum minutes to wait between billing retry attempts for a wishlist intent.', 'integer',
        '60'::jsonb, '{"minimum":5,"maximum":1440}'::jsonb, false, 160)
  ) as t(policy_key, category, label, description, value_type, value_json, validation_schema, is_high_risk, display_order)
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
  d.validation_schema,
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
