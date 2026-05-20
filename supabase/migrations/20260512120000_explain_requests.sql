-- Explain requests — "I don't understand this" signals from users.
-- Created via the Explain toolkit tool by clicking on a confusing element.
-- Routes to org admin (for org-specific content) or CSC staff (for site-wide content).
-- Mirrors delta_flags in shape but carries a different intent: help request, not error report.

CREATE TABLE IF NOT EXISTS explain_requests (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  page_url          text        NOT NULL,
  organization_id   uuid        REFERENCES organizations(id) ON DELETE SET NULL,
  element_text      text,                     -- text of the element the user clicked on
  element_selector  text,                     -- CSS selector for the element
  note              text,                     -- user's question / what they don't understand
  status            text        NOT NULL DEFAULT 'pending',  -- pending | responded | closed
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Users can see their own requests; admins can see all.
ALTER TABLE explain_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "explain_requests_own_select"
  ON explain_requests FOR SELECT
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND global_role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "explain_requests_insert"
  ON explain_requests FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Admins can update status (mark responded / closed).
CREATE POLICY "explain_requests_admin_update"
  ON explain_requests FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND global_role IN ('admin', 'super_admin')
    )
  );

CREATE INDEX IF NOT EXISTS explain_requests_user_id_idx   ON explain_requests(user_id);
CREATE INDEX IF NOT EXISTS explain_requests_org_idx       ON explain_requests(organization_id);
CREATE INDEX IF NOT EXISTS explain_requests_status_idx    ON explain_requests(status);
