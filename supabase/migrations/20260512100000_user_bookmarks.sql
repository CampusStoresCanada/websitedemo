-- User bookmarks — saved pages within the CSC site.
-- Each bookmark stores the URL and display title; an optional note is user-supplied.
-- No foreign key to a specific resource — bookmarks are URL-based so they survive
-- org renames and page restructures (the stored URL is always the canonical one).

CREATE TABLE IF NOT EXISTS user_bookmarks (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  url         text        NOT NULL,
  title       text        NOT NULL,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, url)   -- one bookmark per user per URL
);

-- Users can only read and write their own bookmarks.
ALTER TABLE user_bookmarks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_bookmarks_select"
  ON user_bookmarks FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "users_own_bookmarks_insert"
  ON user_bookmarks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users_own_bookmarks_delete"
  ON user_bookmarks FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "users_own_bookmarks_update"
  ON user_bookmarks FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Index to quickly fetch all bookmarks for a given user.
CREATE INDEX IF NOT EXISTS user_bookmarks_user_id_idx ON user_bookmarks(user_id);
