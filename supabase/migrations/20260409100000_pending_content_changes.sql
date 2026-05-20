-- ============================================================
-- Pending Content Changes — dual-control second-signer queue
-- Tier 2 field edits (site-wide content, public URLs, images)
-- are staged here until a second admin approves or rejects them.
-- Org-scoped edits on /org/[slug] bypass this table entirely.
-- ============================================================

-- ── 1. Status enum ───────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pending_change_status') THEN
    CREATE TYPE public.pending_change_status AS ENUM (
      'pending',
      'approved',
      'rejected',
      'expired'
    );
  END IF;
END $$;

-- ── 2. pending_content_changes ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.pending_content_changes (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What is being changed
  target_table          text        NOT NULL
    CHECK (target_table IN ('organizations','contacts','brand_colors','benchmarking','site_content')),
  target_column         text        NOT NULL,
  target_entity_id      uuid        NOT NULL,

  -- Values (jsonb handles text, number, null uniformly)
  proposed_value        jsonb       NOT NULL,
  previous_value        jsonb,

  -- Human-readable context for review UI and email
  entity_display_name   text,
  field_display_label   text,
  page_href             text,       -- deeplink, e.g. /about
  anchor_id             text,       -- HTML anchor, e.g. review-site_content-hero_title-{uuid}

  -- Counter-proposal chain
  counter_to_id         uuid        REFERENCES public.pending_content_changes(id) ON DELETE SET NULL,

  -- Who & when
  requested_by          uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  requested_at          timestamptz NOT NULL DEFAULT now(),
  expires_at            timestamptz NOT NULL DEFAULT (now() + interval '48 hours'),

  -- Review
  status                public.pending_change_status NOT NULL DEFAULT 'pending',
  reviewed_by           uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at           timestamptz,
  review_note           text,

  -- Audit
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pcc_different_reviewer
    CHECK (reviewed_by IS NULL OR reviewed_by <> requested_by)
);

-- ── 3. Indexes ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_pcc_pending_expires
  ON public.pending_content_changes (status, expires_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_pcc_target_pending
  ON public.pending_content_changes (target_table, target_column, target_entity_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_pcc_requested_by
  ON public.pending_content_changes (requested_by);

CREATE INDEX IF NOT EXISTS idx_pcc_requested_at
  ON public.pending_content_changes (requested_at DESC);

-- ── 4. updated_at trigger ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pcc_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pcc_updated_at_trigger ON public.pending_content_changes;
CREATE TRIGGER pcc_updated_at_trigger
  BEFORE UPDATE ON public.pending_content_changes
  FOR EACH ROW EXECUTE FUNCTION public.pcc_set_updated_at();

-- ── 5. RLS ───────────────────────────────────────────────────
ALTER TABLE public.pending_content_changes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pcc_admin_all ON public.pending_content_changes;
CREATE POLICY pcc_admin_all
  ON public.pending_content_changes
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.global_role IN ('admin', 'super_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.global_role IN ('admin', 'super_admin')
    )
  );

DROP POLICY IF EXISTS pcc_requester_read_own ON public.pending_content_changes;
CREATE POLICY pcc_requester_read_own
  ON public.pending_content_changes
  FOR SELECT
  USING (requested_by = auth.uid());

COMMENT ON TABLE public.pending_content_changes IS
  'Dual-control approval queue. Tier 2 field edits are staged here '
  'until a second admin approves or rejects them. Org-scoped edits bypass this table.';

-- ============================================================
-- content_change_tokens — short-lived single-use tokens for
-- email deep-links. Browser navigates to page_href?review_token={token}
-- ============================================================

CREATE TABLE IF NOT EXISTS public.content_change_tokens (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  change_id         uuid        NOT NULL REFERENCES public.pending_content_changes(id) ON DELETE CASCADE,
  token_hash        text        NOT NULL UNIQUE,  -- SHA-256 of the raw token
  intended_for      uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  expires_at        timestamptz NOT NULL,
  used_at           timestamptz,                  -- set on first use; token becomes invalid
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cct_token_hash
  ON public.content_change_tokens (token_hash)
  WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cct_change_id
  ON public.content_change_tokens (change_id);

ALTER TABLE public.content_change_tokens ENABLE ROW LEVEL SECURITY;

-- Tokens are only ever read/written via the admin client (server actions).
-- No direct user access needed — deny all via RLS.
DROP POLICY IF EXISTS cct_deny_all ON public.content_change_tokens;
CREATE POLICY cct_deny_all
  ON public.content_change_tokens
  FOR ALL
  USING (false);

COMMENT ON TABLE public.content_change_tokens IS
  'Single-use tokens for email review deep-links. '
  'Validated server-side; token_hash is SHA-256 of the raw token sent in email.';
