-- Expand audience_mode from binary (public / members_only) to 6 granular levels.
-- Applied to remote 2026-05-20.

-- Step 1: Drop the old binary check constraint
ALTER TABLE events DROP CONSTRAINT events_audience_mode_check;

-- Step 2: Normalize legacy "members_only" rows before adding the new constraint
UPDATE events
SET audience_mode = 'members'
WHERE audience_mode = 'members_only';

-- Step 3: Add the new constraint covering all 6 granular audience modes
ALTER TABLE events ADD CONSTRAINT events_audience_mode_check
  CHECK (audience_mode = ANY (ARRAY[
    'public',
    'members_and_partners',
    'members',
    'partners',
    'org_admin',
    'board'
  ]));
