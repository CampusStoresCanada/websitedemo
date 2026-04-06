-- Track which website alerts a user has read/dismissed.
-- alert_key is the composite id from the alerts API (e.g. "invoice:uuid", "renewal:uuid").

CREATE TABLE IF NOT EXISTS user_alert_reads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  alert_key text NOT NULL,
  read_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, alert_key)
);

CREATE INDEX IF NOT EXISTS idx_user_alert_reads_user ON user_alert_reads(user_id);

-- RLS: users can only read/write their own rows
ALTER TABLE user_alert_reads ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_alert_reads' AND policyname = 'Users manage own alert reads') THEN
    CREATE POLICY "Users manage own alert reads"
      ON user_alert_reads
      FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- Auto-cleanup: delete reads older than 90 days to prevent unbounded growth.
-- This is safe because resolved alerts won't reappear from the alerts API anyway.
CREATE INDEX IF NOT EXISTS idx_user_alert_reads_read_at ON user_alert_reads(read_at);
