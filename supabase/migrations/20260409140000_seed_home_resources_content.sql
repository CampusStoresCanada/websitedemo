-- Seed site_content rows for the Home page and Resources page static sections.
-- Mirrors the pattern established for About page content.

-- ─────────────────────────────────────────────────────────────────
-- Home page
-- ─────────────────────────────────────────────────────────────────

-- ValueProps section header (the "More than a network." block)
INSERT INTO site_content (section, content_type, title, body, display_order, is_active)
VALUES (
  'home_value_props_header',
  'text',
  'More than a network.',
  'CSC transforms campus retail from a traditional business operation into a vital educational partner that enhances student success.',
  0,
  true
)
ON CONFLICT DO NOTHING;

-- ValueProps cards (one row per card, display_order 0-3)
-- Bullet points stored in metadata so card titles/bodies are inline-editable.
INSERT INTO site_content (section, content_type, title, body, metadata, display_order, is_active)
VALUES
  (
    'home_value_props', 'card',
    'Community of Practice',
    'Connect with peers facing similar challenges. Facilitate knowledge sharing, problem solving, and build collective wisdom from shared experiences.',
    '{"icon":"community","bullets":["Direct peer connections","Professional development","Collaborative problem-solving"]}',
    0, true
  ),
  (
    'home_value_props', 'card',
    'Collective Voice',
    'Advocate for independent stores with administrators. Provide data and frameworks to demonstrate value to institutions.',
    '{"icon":"voice","bullets":["Unified industry responses","Amplify member concerns","Canadian representation"]}',
    1, true
  ),
  (
    'home_value_props', 'card',
    'Resource Hub',
    'Access best practices, benchmarking data, tools, templates, and curated vendor relationships all in one place.',
    '{"icon":"resource","bullets":["Benchmarking data & analysis","Tools and templates","Educational content & training"]}',
    2, true
  ),
  (
    'home_value_props', 'card',
    'Innovation Catalyst',
    'Identify emerging trends and opportunities. Test new approaches collectively and share successful experiments.',
    '{"icon":"innovation","bullets":["Trend identification","Reduced innovation risk","Strategic evolution support"]}',
    3, true
  )
ON CONFLICT DO NOTHING;

-- Home CTA section
INSERT INTO site_content (section, content_type, title, body, display_order, is_active)
VALUES (
  'home_cta',
  'text',
  'Ready to join the network?',
  'Connect with campus stores across Canada. Share resources, build partnerships, and grow together.',
  0,
  true
)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────
-- Resources page
-- ─────────────────────────────────────────────────────────────────

-- Resources hero
INSERT INTO site_content (section, content_type, title, body, display_order, is_active)
VALUES (
  'resources_hero',
  'text',
  'Resources',
  'Benchmarking data, community discussions, and advocacy tools for campus store professionals.',
  0,
  true
)
ON CONFLICT DO NOTHING;

-- Independence Defense Network section
INSERT INTO site_content (section, content_type, title, body, metadata, display_order, is_active)
VALUES (
  'resources_independence_defense',
  'text',
  'Independence Defense Network',
  'When campus stores face challenges to their institutional independence — from outsourcing proposals to governance changes — the CSC Independence Defense Network provides peer support, advocacy tools, and expert resources.',
  '{"bullets":["Peer consultation with stores that have navigated similar challenges","Template business cases and advocacy materials","Data-backed arguments for campus-operated stores","Confidential support network of experienced leaders"],"cta_text":"Access IDN Resources","cta_href":"/login"}',
  0,
  true
)
ON CONFLICT DO NOTHING;
