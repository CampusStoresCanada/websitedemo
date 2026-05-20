-- Set board position titles on the board_of_directors site_content slots.
-- The subtitle column = the person's role on the board (President, VP, etc.)
-- NOT their day-job at their institution. display_order defines the row layout:
--   Row 1: display_order 1-3  → President | Vice President | Secretary
--   Row 2: display_order 4-6  → Past President | Treasurer | Director
--   Row 3: display_order 7-9  → Director | Director | Director

UPDATE site_content SET subtitle = 'President'
WHERE section = 'board_of_directors' AND display_order = 1;

UPDATE site_content SET subtitle = 'Vice President'
WHERE section = 'board_of_directors' AND display_order = 2;

UPDATE site_content SET subtitle = 'Secretary'
WHERE section = 'board_of_directors' AND display_order = 3;

UPDATE site_content SET subtitle = 'Past President'
WHERE section = 'board_of_directors' AND display_order = 4;

UPDATE site_content SET subtitle = 'Treasurer'
WHERE section = 'board_of_directors' AND display_order = 5;

UPDATE site_content SET subtitle = 'Director'
WHERE section = 'board_of_directors' AND display_order >= 6;
