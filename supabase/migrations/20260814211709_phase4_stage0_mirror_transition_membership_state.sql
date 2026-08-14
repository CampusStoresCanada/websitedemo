-- Phase 4 Stage 0: mirror transition_membership_state()'s organizations write
-- into the matching memberships row, in the same transaction. organizations
-- stays the sole write authority in this stage (Stage 3 will cut over) --
-- this is strictly an additive, best-effort mirror so `memberships` never
-- silently drifts from real org status changes between the Stage 0 backfill
-- and Stage 1 (the read consumers) landing.
CREATE OR REPLACE FUNCTION public.transition_membership_state(p_org_id uuid, p_new_status org_membership_status, p_triggered_by text, p_actor_id uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text, p_metadata jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_current_status org_membership_status;
  v_org_type text;
  v_locked_at timestamptz;
  v_allowed boolean := false;
  v_now timestamptz := now();
  v_program_key text;
BEGIN
  -- Lock the row to prevent concurrent transitions
  SELECT membership_status, type, locked_at
  INTO v_current_status, v_org_type, v_locked_at
  FROM organizations
  WHERE id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Organization not found');
  END IF;

  -- Validate triggered_by
  IF p_triggered_by NOT IN ('user', 'admin', 'system', 'stripe_webhook', 'renewal_job') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid triggered_by value');
  END IF;

  -- Handle initial state (NULL → applied)
  IF v_current_status IS NULL THEN
    IF p_new_status = 'applied' THEN
      v_allowed := true;
    END IF;
  ELSE
    -- Validate transition is allowed
    v_allowed := CASE
      WHEN v_current_status = 'applied'     AND p_new_status = 'approved'    THEN true
      WHEN v_current_status = 'approved'    AND p_new_status = 'active'      THEN true
      WHEN v_current_status = 'active'      AND p_new_status = 'grace'       THEN true
      WHEN v_current_status = 'active'      AND p_new_status = 'canceled'    THEN true
      WHEN v_current_status = 'grace'       AND p_new_status = 'active'      THEN true
      WHEN v_current_status = 'grace'       AND p_new_status = 'locked'      THEN true
      WHEN v_current_status = 'grace'       AND p_new_status = 'canceled'    THEN true
      WHEN v_current_status = 'locked'      AND p_new_status = 'reactivated' THEN true
      WHEN v_current_status = 'reactivated' AND p_new_status = 'grace'       THEN true
      WHEN v_current_status = 'reactivated' AND p_new_status = 'canceled'    THEN true
      ELSE false
    END;
  END IF;

  IF NOT v_allowed THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Transition from %s to %s is not allowed',
        COALESCE(v_current_status::text, 'NULL'), p_new_status::text)
    );
  END IF;

  -- Update organization status + timestamps
  UPDATE organizations
  SET
    membership_status = p_new_status,
    membership_status_changed_at = v_now,
    grace_period_started_at = CASE
      WHEN p_new_status = 'grace' THEN v_now
      WHEN p_new_status IN ('active', 'locked', 'canceled') THEN NULL
      ELSE grace_period_started_at
    END,
    locked_at = CASE
      WHEN p_new_status = 'locked' THEN v_now
      WHEN p_new_status IN ('reactivated', 'canceled') THEN NULL
      ELSE locked_at
    END,
    canceled_at = CASE
      WHEN p_new_status = 'canceled' THEN v_now
      ELSE canceled_at
    END
  WHERE id = p_org_id;

  -- Phase 4 Stage 0: mirror into memberships (best-effort; organizations
  -- above remains authoritative this stage). Only orgs whose type maps to
  -- a real configured program get a mirrored row -- matches the backfill's
  -- "Non-Member/Staff/Supplier orgs hold no real membership" behavior.
  v_program_key := CASE v_org_type
    WHEN 'Member' THEN 'member'
    WHEN 'Vendor Partner' THEN 'partner'
    ELSE NULL
  END;

  IF v_program_key IS NOT NULL THEN
    UPDATE memberships
    SET
      status = p_new_status,
      status_changed_at = v_now,
      grace_period_started_at = CASE
        WHEN p_new_status = 'grace' THEN v_now
        WHEN p_new_status IN ('active', 'locked', 'canceled') THEN NULL
        ELSE grace_period_started_at
      END,
      locked_at = CASE
        WHEN p_new_status = 'locked' THEN v_now
        WHEN p_new_status IN ('reactivated', 'canceled') THEN NULL
        ELSE locked_at
      END,
      canceled_at = CASE
        WHEN p_new_status = 'canceled' THEN v_now
        ELSE canceled_at
      END,
      updated_at = v_now
    WHERE organization_id = p_org_id
      AND program_key = v_program_key;

    IF NOT FOUND THEN
      INSERT INTO memberships (
        organization_id, program_key, status, status_changed_at,
        grace_period_started_at, locked_at, canceled_at
      ) VALUES (
        p_org_id, v_program_key, p_new_status, v_now,
        CASE WHEN p_new_status = 'grace' THEN v_now ELSE NULL END,
        CASE WHEN p_new_status = 'locked' THEN v_now ELSE NULL END,
        CASE WHEN p_new_status = 'canceled' THEN v_now ELSE NULL END
      );
    END IF;
  END IF;

  -- Insert state log record
  INSERT INTO membership_state_log (
    organization_id, from_status, to_status,
    triggered_by, actor_id, reason, metadata
  ) VALUES (
    p_org_id, v_current_status, p_new_status,
    p_triggered_by, p_actor_id, p_reason, p_metadata
  );

  RETURN jsonb_build_object(
    'success', true,
    'from_status', COALESCE(v_current_status::text, 'none'),
    'to_status', p_new_status::text
  );
END;
$function$;
