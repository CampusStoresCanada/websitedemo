-- Enable trigram extension for fuzzy search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Page snapshots: structured data frozen at share time
-- Public SELECT (no auth needed for viewing), authenticated INSERT, own DELETE
CREATE TABLE IF NOT EXISTS page_snapshots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type          TEXT NOT NULL,
  snapshot      JSONB NOT NULL,
  page_url      TEXT NOT NULL,
  page_title    TEXT NOT NULL,
  note          TEXT,
  created_by    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_email TEXT,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE page_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read snapshots"
  ON page_snapshots FOR SELECT USING (true);

CREATE POLICY "Authenticated users can create snapshots"
  ON page_snapshots FOR INSERT
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Creators can delete own snapshots"
  ON page_snapshots FOR DELETE
  USING (auth.uid() = created_by);

CREATE INDEX IF NOT EXISTS page_snapshots_expires_at_idx ON page_snapshots(expires_at);
CREATE INDEX IF NOT EXISTS page_snapshots_created_by_idx ON page_snapshots(created_by);

GRANT SELECT ON TABLE public.page_snapshots TO anon, authenticated;
GRANT INSERT ON TABLE public.page_snapshots TO authenticated;
GRANT DELETE ON TABLE public.page_snapshots TO authenticated;

-- Internal shares log (audit trail for who shared what to whom)
CREATE TABLE IF NOT EXISTS internal_shares (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  page_url      TEXT NOT NULL,
  page_title    TEXT NOT NULL,
  note          TEXT,
  sent_via      TEXT, -- 'circle_dm' | 'email'
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE internal_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can create internal shares"
  ON internal_shares FOR INSERT
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Admins can read all internal shares"
  ON internal_shares FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.global_role IN ('admin', 'super_admin')
    )
  );

GRANT SELECT, INSERT ON TABLE public.internal_shares TO authenticated;
