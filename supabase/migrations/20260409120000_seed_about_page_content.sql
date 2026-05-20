-- Seed site_content rows for the About page static sections.
-- These back the previously-hardcoded AboutHero and MissionSection components,
-- making them editable through the four-eyes approval system.

-- About Hero
INSERT INTO site_content (section, content_type, title, body, display_order, is_active)
VALUES (
  'about_hero',
  'text',
  'About Campus Stores Canada',
  'The national voice for campus retail in Canada — connecting post-secondary bookstores, campus shops, and their vendor partners since 2004.',
  0,
  true
)
ON CONFLICT DO NOTHING;

-- Mission Statement
INSERT INTO site_content (section, content_type, title, body, display_order, is_active)
VALUES (
  'about_mission',
  'text',
  'Our Mission',
  'Campus Stores Canada (CSC) advocates for and supports campus retail operations at post-secondary institutions across the country. We provide a forum for collaboration, professional development, benchmarking, and shared purchasing power — ensuring campus stores can deliver exceptional service to students, faculty, and staff.',
  0,
  true
)
ON CONFLICT DO NOTHING;

-- What We Do bullets (one row per item, ordered by display_order)
INSERT INTO site_content (section, content_type, body, display_order, is_active)
VALUES
  ('about_what_we_do', 'bullet', 'Benchmarking surveys and data sharing to help stores make data-driven decisions', 0, true),
  ('about_what_we_do', 'bullet', 'Annual conferences, regional meetups, and peer-learning opportunities', 1, true),
  ('about_what_we_do', 'bullet', 'Vendor partner program connecting stores with trusted suppliers', 2, true),
  ('about_what_we_do', 'bullet', 'Advocacy for institutional independence and campus retail sustainability', 3, true)
ON CONFLICT DO NOTHING;
