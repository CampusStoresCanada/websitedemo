-- Collapse billing.partnership_rate to a single value ($500/yr) everywhere.
-- The active policy set already reads 500 (real checkout amounts are already
-- correct); this only corrects the stale $600 left in the old inactive
-- "v1.0 Initial Policies" set so there is exactly one number on record.
update policy_values
set value_json = '500'::jsonb
where key = 'billing.partnership_rate'
  and value_json = '600'::jsonb;
