-- Phase 4 Stage 3: invert the mirror — `memberships` becomes the authoritative
-- source of an org's membership lifecycle state, and `organizations`' legacy
-- columns become the maintained copy.
--
-- Two things change in transition_membership_state():
--
--  1. The CURRENT state used to validate a transition is now read from the
--     org's `memberships` row rather than `organizations.membership_status`.
--     This is the actual inversion — it is what makes `memberships` the source
--     of truth rather than just a synchronized copy.
--  2. `memberships` is written first, as the primary target; the UPDATE to
--     `organizations` that follows is now explicitly the mirror.
--
-- `organizations.membership_status` (and its companion timestamp columns) are
-- deliberately NOT dropped and are still written on every transition: ~150
-- call sites across the app still read them, including ~50 query-level filters.
-- Dropping them is a separate, much wider migration and is out of scope here.
--
-- Preserved behavior, verified against live data before writing this:
--  * Orgs whose type maps to no configured program ("Non-Member", "Staff",
--    "Supplier" — 7 orgs today) hold no `memberships` row by design. For those,
--    `organizations` remains the only state store and the read falls back to it.
--    All 7 have membership_status NULL and have never been transitioned (zero
--    rows in membership_state_log), so this path stays theoretical for CSC.
--  * Every org that does carry a membership_status (202/202) has a matching
--    `memberships` row, so the authoritative read resolves for all of them.
--  * The `FOR UPDATE` lock on `organizations` is retained as the serialization
--    point for concurrent transitions, with the membership row locked too.

CREATE OR REPLACE FUNCTION public.transition_membership_state(p_org_id uuid, p_new_status org_membership_status, p_triggered_by text, p_actor_id uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text, p_metadata jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_current_status org_membership_status;
  v_org_status org_membership_status;
  v_membership_status org_membership_status;
  v_membership_found boolean := false;
  v_org_type text;
  v_locked_at timestamptz;
  v_allowed boolean := false;
  v_now timestamptz := now();
  v_program_key text;
BEGIN
  -- Lock the organization row: still the serialization point that prevents
  -- concurrent transitions for the same org, even though it is no longer the
  -- authoritative state store.
  SELECT membership_status, type, locked_at
  INTO v_org_status, v_org_type, v_locked_at
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

  v_program_key := CASE v_org_type
    WHEN 'Member' THEN 'member'
    WHEN 'Vendor Partner' THEN 'partner'
    ELSE NULL
  END;

  -- Phase 4 Stage 3: read current state from `memberships` (authoritative),
  -- falling back to `organizations` only when this org holds no membership
  -- row -- i.e. a program-less org type, or the NULL -> 'applied' bootstrap
  -- before any row exists.
  IF v_program_key IS NOT NULL THEN
    SELECT status INTO v_membership_status
    FROM memberships
    WHERE organization_id = p_org_id
      AND program_key = v_program_key
    FOR UPDATE;

    v_membership_found := FOUND;
  END IF;

  v_current_status := CASE
    WHEN v_membership_found THEN v_membership_status
    ELSE v_org_status
  END;

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

  -- ── Authoritative write: memberships ──────────────────────────────
  IF v_program_key IS NOT NULL THEN
    IF v_membership_found THEN
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
    ELSE
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

  -- ── Mirror: organizations' legacy columns ─────────────────────────
  -- Same transaction, so the two can never diverge. Kept because ~150 call
  -- sites still read these columns; this is no longer the source of truth.
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

COMMENT ON TABLE memberships IS $c$Phase 4: membership as its own entity, distinct from organizations/people. As of Stage 3 this table is the authoritative store of membership lifecycle state -- transition_membership_state() reads current state from here and writes it here first, then mirrors into the legacy columns on organizations (membership_status et al), which ~150 read sites still depend on and which are therefore retained.$c$;
