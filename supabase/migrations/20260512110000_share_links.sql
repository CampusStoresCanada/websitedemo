-- Share links — time-limited, usage-capped links to a specific page.
-- Recipients visit /s/<id> which shows a landing page and directs them
-- to the target page. Tracks creation, usage, and expiry.

CREATE TABLE IF NOT EXISTS share_links (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by    uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  page_url      text        NOT NULL,        -- relative URL being shared (e.g. /members/ubc)
  page_title    text        NOT NULL,        -- display title for the landing page
  note          text,                        -- optional message from the sharer
  expires_at    timestamptz NOT NULL,        -- link is invalid after this
  max_uses      int         NOT NULL DEFAULT 25,
  use_count     int         NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Any authenticated user can create share links.
-- Anyone (including unauthenticated) can read a share link to validate it on the landing page.
ALTER TABLE share_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "share_links_select_any"
  ON share_links FOR SELECT
  USING (true);

CREATE POLICY "share_links_insert_authenticated"
  ON share_links FOR INSERT
  WITH CHECK (auth.uid() = created_by);

-- Only the creator can delete their own share links.
CREATE POLICY "share_links_delete_own"
  ON share_links FOR DELETE
  USING (auth.uid() = created_by);

-- Use count updated server-side only (security definer function below).
-- No direct UPDATE policy for regular users.

-- Function to safely increment use count (bypasses RLS).
CREATE OR REPLACE FUNCTION increment_share_link_use(link_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE share_links
  SET use_count = use_count + 1
  WHERE id = link_id
    AND expires_at > now()
    AND use_count < max_uses;
END;
$$;

CREATE INDEX IF NOT EXISTS share_links_created_by_idx ON share_links(created_by);
