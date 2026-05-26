-- ─────────────────────────────────────────────────────────────────────────────
-- Onboarding Journey Infrastructure
--
-- Tracks each user's progress through their persona-specific onboarding journey.
-- One row per user per step. The cron job reads this to decide what to send next;
-- client code writes completion events here when actions are taken.
--
-- See docs/ONBOARDING_JOURNEY.md for the full journey map and step definitions.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE user_onboarding_progress (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Which journey this step belongs to.
  -- Matches the persona slugs in ONBOARDING_JOURNEY.md.
  persona               text        NOT NULL
                          CHECK (persona IN ('org_admin', 'member', 'partner', 'board')),

  -- Canonical step key. See "All Step Keys" section in ONBOARDING_JOURNEY.md.
  step_key              text        NOT NULL,

  -- When the journey started for this user (copied from the welcome step, or
  -- set when the first step is inserted). Used to calculate time-based triggers.
  journey_started_at    timestamptz NOT NULL DEFAULT now(),

  -- Delivery tracking
  sent_at               timestamptz,           -- when the nudge was sent (email or in-app)
  channel               text                   -- 'email' | 'in_app' | 'both'
                          CHECK (channel IN ('email', 'in_app', 'both')),

  -- Completion tracking
  completed_at          timestamptz,           -- when the user took the action that marks this done
  skipped_at            timestamptz,           -- set if we decided this step doesn't apply (e.g. no active conference)
  skip_reason           text,

  -- Reminder tracking
  reminder_count        integer     NOT NULL DEFAULT 0,
  last_reminder_sent_at timestamptz,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  -- One row per user per step. If a step recurs (conference, benchmarking),
  -- the existing row is reset rather than a new one inserted.
  UNIQUE (user_id, step_key)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────────────────────────────────────

-- Cron job: "find all org_admin steps that are due but not yet sent"
CREATE INDEX idx_uop_persona_sent
  ON user_onboarding_progress (persona, sent_at)
  WHERE sent_at IS NULL AND skipped_at IS NULL;

-- Cron job: "find incomplete steps that may need a reminder"
CREATE INDEX idx_uop_incomplete
  ON user_onboarding_progress (user_id, completed_at, last_reminder_sent_at)
  WHERE completed_at IS NULL AND skipped_at IS NULL;

-- Lookup: "what has this user done?"
CREATE INDEX idx_uop_user
  ON user_onboarding_progress (user_id, persona);

-- ─────────────────────────────────────────────────────────────────────────────
-- updated_at trigger
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Only create trigger if it doesn't already exist on this table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_uop_updated_at'
      AND tgrelid = 'user_onboarding_progress'::regclass
  ) THEN
    CREATE TRIGGER trg_uop_updated_at
      BEFORE UPDATE ON user_onboarding_progress
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE user_onboarding_progress ENABLE ROW LEVEL SECURITY;

-- Users can read their own progress (for the in-app widget)
CREATE POLICY "users_read_own_onboarding_progress"
  ON user_onboarding_progress
  FOR SELECT
  USING (auth.uid() = user_id);

-- Only the service role (admin client) writes — cron + server actions
-- No client-facing INSERT/UPDATE policies. All writes go through server actions.

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper view: onboarding summary per user
-- Useful for admin dashboards and the "is this user onboarding-complete?" check.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE VIEW user_onboarding_summary AS
SELECT
  user_id,
  persona,
  journey_started_at,
  COUNT(*)                                          AS total_steps,
  COUNT(*) FILTER (WHERE completed_at IS NOT NULL)  AS completed_steps,
  COUNT(*) FILTER (WHERE skipped_at IS NOT NULL)    AS skipped_steps,
  COUNT(*) FILTER (
    WHERE completed_at IS NULL
      AND skipped_at   IS NULL
      AND sent_at      IS NOT NULL
  )                                                 AS pending_steps,
  MIN(journey_started_at)                           AS started_at,
  MAX(completed_at)                                 AS last_completed_at
FROM user_onboarding_progress
GROUP BY user_id, persona, journey_started_at;

COMMENT ON TABLE user_onboarding_progress IS
  'Tracks each user''s progress through their persona-specific onboarding journey. '
  'See docs/ONBOARDING_JOURNEY.md for the full step definitions and journey map.';
