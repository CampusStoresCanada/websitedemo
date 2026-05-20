-- ---------------------------------------------------------------------------
-- Circle event sync support
--
-- circle_event_rsvp_cache
--   Tracks all Circle event attendees — both for website-pushed events
--   (reconciled against event_registrations) and Circle-native events
--   (people who may not have website accounts).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS circle_event_rsvp_cache (
  id                  uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id            uuid        REFERENCES events(id) ON DELETE CASCADE,
  circle_event_id     integer     NOT NULL,
  circle_member_id    integer     NOT NULL,
  circle_attendee_id  integer,                -- Circle's event_attendee record id
  supabase_user_id    uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  member_name         text,
  rsvp_status         text        NOT NULL DEFAULT 'going',
  reconciled          boolean     NOT NULL DEFAULT false,  -- true = matched to event_registrations
  synced_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (circle_event_id, circle_member_id)
);

-- Index for fast lookup when reconciling
CREATE INDEX IF NOT EXISTS idx_circle_event_rsvp_event_id ON circle_event_rsvp_cache (event_id);
CREATE INDEX IF NOT EXISTS idx_circle_event_rsvp_user_id  ON circle_event_rsvp_cache (supabase_user_id);

-- RLS: admins and super_admins only (this is internal sync state)
ALTER TABLE circle_event_rsvp_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "circle_event_rsvp_cache_admin_all"
  ON circle_event_rsvp_cache
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.global_role IN ('admin', 'super_admin')
    )
  );
