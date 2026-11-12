-- The tier every sponsorship bought as its own item sits under.
--
-- sponsor_agreements.tier_id is NOT NULL, and a sponsorship sold as a priced
-- catalog item (Ambassador, Kivuto, 2026) is not one of the packaged tiers.
-- Its benefits come from the item and are copied onto the agreement
-- (lib/sponsorship/sponsorship-agreement.ts), so this tier carries no price and
-- no benefits. Inactive, so it never appears in a tier picker; its name is
-- what the public sponsor listings show for these sponsors.

INSERT INTO public.sponsor_tiers (name, slug, description, price_cents, color, icon, display_order, is_active, max_sponsors, benefits)
SELECT
  'Sponsor',
  'custom',
  'Sponsorships sold as their own catalog item. Benefits come from the item, not the tier.',
  NULL,
  NULL,
  'award',
  99,
  false,
  NULL,
  '[]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.sponsor_tiers WHERE slug = 'custom');
