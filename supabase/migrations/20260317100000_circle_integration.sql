-- ---------------------------------------------------------------------------
-- Circle Integration Tables
-- Chunk 10: circle_sync_queue + circle_member_mapping
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- circle_sync_queue
-- Outbound and retry queue for Circle API operations.
-- Matches columns used by lib/circle/sync.ts.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS circle_sync_queue (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation         text NOT NULL,
  entity_type       text NOT NULL CHECK (entity_type IN ('contact', 'organization')),
  entity_id         uuid NOT NULL,
  payload           jsonb NOT NULL DEFAULT '{}',
  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts          integer NOT NULL DEFAULT 0,
  max_attempts      integer NOT NULL DEFAULT 3,
  last_error        text,
  idempotency_key   text UNIQUE,
  next_retry_at     timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz
);

-- Index for the queue processor: pick up pending/failed items ready to retry
CREATE INDEX IF NOT EXISTS idx_circle_sync_queue_pending
  ON circle_sync_queue (status, next_retry_at)
  WHERE status IN ('pending', 'failed');

-- Index for dedup by entity
CREATE INDEX IF NOT EXISTS idx_circle_sync_queue_entity
  ON circle_sync_queue (entity_id, operation, status);

-- ---------------------------------------------------------------------------
-- circle_member_mapping
-- Explicit bidirectional identity map: Supabase user ↔ Circle member.
-- Used by the Launch Day Auth Cutover.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS circle_member_mapping (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  contact_id          uuid REFERENCES contacts(id) ON DELETE SET NULL,
  circle_member_id    integer NOT NULL,
  match_method        text NOT NULL DEFAULT 'email'
                      CHECK (match_method IN ('email', 'manual', 'sso_id')),
  match_confidence    text NOT NULL DEFAULT 'high'
                      CHECK (match_confidence IN ('high', 'low')),
  verified            boolean NOT NULL DEFAULT false,
  verified_at         timestamptz,
  verified_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- One mapping per Circle member ID (can only link to one Supabase user)
CREATE UNIQUE INDEX IF NOT EXISTS idx_circle_member_mapping_circle_id
  ON circle_member_mapping (circle_member_id);

-- Lookup by Supabase user
CREATE INDEX IF NOT EXISTS idx_circle_member_mapping_user
  ON circle_member_mapping (supabase_user_id)
  WHERE supabase_user_id IS NOT NULL;

-- Lookup by contact
CREATE INDEX IF NOT EXISTS idx_circle_member_mapping_contact
  ON circle_member_mapping (contact_id)
  WHERE contact_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- RLS policies
-- Both tables are server-only (admin client) — no direct client access.
-- ---------------------------------------------------------------------------
ALTER TABLE circle_sync_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE circle_member_mapping ENABLE ROW LEVEL SECURITY;

-- Service role (admin client) can do everything; no user-facing policies needed.
-- (The admin client bypasses RLS by design.)
