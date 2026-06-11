-- Seed booth inventory + booth products for the existing 2027 conference instance.
--
-- The earlier seed blocks in 20260609100000_conference_booths.sql and
-- 20260609120000_conference_booth_products.sql were conditioned on
-- (year = 2027 and edition_code = '00'), but the only 2027 conference
-- instance currently in the database has edition_code = '99'. Those seeds
-- silently no-op'd. This migration seeds the same data against whichever
-- 2027 conference instance actually exists.

do $$
declare
  v_conf_id     uuid;
  v_std_id      uuid;
  v_con_id      uuid;
  v_partner_id  uuid;
  v_network_id  uuid;
begin
  select id into v_conf_id
  from public.conference_instances
  where year = 2027
  order by edition_code
  limit 1;

  if v_conf_id is null then
    raise notice 'No 2027 conference instance found — skipping booth seed.';
    return;
  end if;

  -- Set sale window dates
  update public.conference_instances
  set
    booth_sales_sponsor_open_at = '2026-07-15 00:00:00 America/Toronto',
    booth_sales_general_open_at = '2026-08-04 10:00:00 America/Toronto'
  where id = v_conf_id
    and booth_sales_sponsor_open_at is null;

  -- ── Booths (60) ────────────────────────────────────────────────────────────
  insert into public.conference_booths
    (conference_id, booth_number, zone, map_cx, map_cy, map_w, map_h)
  values
    -- ── Connected booths (31) ──────────────────────────────────────────────
    (v_conf_id, '100', 'connected',  969, 159, 69, 55),
    (v_conf_id, '102', 'connected', 1039, 159, 69, 55),
    (v_conf_id, '104', 'connected', 1108, 159, 69, 55),
    (v_conf_id, '106', 'connected', 1177, 159, 69, 55),
    (v_conf_id, '108', 'connected', 1246, 159, 69, 55),
    (v_conf_id, '110', 'connected', 1314, 159, 69, 55),
    (v_conf_id, '112', 'connected', 1383, 159, 69, 55),

    (v_conf_id, '101', 'connected', 1036, 272, 69, 55),
    (v_conf_id, '103', 'connected', 1102, 272, 69, 55),
    (v_conf_id, '105', 'connected', 1170, 272, 69, 55),
    (v_conf_id, '107', 'connected', 1239, 272, 69, 55),
    (v_conf_id, '109', 'connected', 1307, 272, 69, 55),

    (v_conf_id, '200', 'connected', 1029, 327, 69, 55),
    (v_conf_id, '202', 'connected', 1099, 327, 69, 55),
    (v_conf_id, '204', 'connected', 1167, 327, 69, 55),
    (v_conf_id, '206', 'connected', 1236, 327, 69, 55),
    (v_conf_id, '208', 'connected', 1305, 327, 69, 55),

    (v_conf_id, '201', 'connected', 1033, 441, 69, 55),
    (v_conf_id, '203', 'connected', 1100, 441, 69, 55),
    (v_conf_id, '205', 'connected', 1168, 441, 69, 55),
    (v_conf_id, '207', 'connected', 1237, 441, 69, 55),
    (v_conf_id, '209', 'connected', 1305, 441, 69, 55),

    (v_conf_id, '300', 'connected', 1029, 496, 69, 55),
    (v_conf_id, '302', 'connected', 1100, 496, 69, 55),
    (v_conf_id, '304', 'connected', 1167, 496, 69, 55),
    (v_conf_id, '306', 'connected', 1236, 496, 69, 55),
    (v_conf_id, '308', 'connected', 1305, 496, 69, 55),

    (v_conf_id, '600', 'connected',  911, 275,  54, 67),

    (v_conf_id, '700', 'connected', 1428, 264,  55, 69),
    (v_conf_id, '702', 'connected', 1428, 333,  55, 69),
    (v_conf_id, '704', 'connected', 1428, 401,  55, 69),

    -- ── Standard booths (29) ──────────────────────────────────────────────
    (v_conf_id,  '01', 'standard',  783, 676, 69, 55),
    (v_conf_id,  '02', 'standard',  713, 676, 69, 55),
    (v_conf_id,  '03', 'standard',  644, 676, 69, 55),

    (v_conf_id,  '04', 'standard',  539, 581,  55, 69),

    (v_conf_id,  '05', 'standard',  696, 558, 69, 55),
    (v_conf_id,  '06', 'standard',  758, 551,  55, 69),
    (v_conf_id,  '07', 'standard',  758, 483,  55, 69),
    (v_conf_id,  '08', 'standard',  696, 476, 69, 55),

    (v_conf_id, '301', 'standard', 1033, 608, 69, 55),
    (v_conf_id, '303', 'standard', 1100, 608, 69, 55),
    (v_conf_id, '305', 'standard', 1168, 608, 69, 55),
    (v_conf_id, '307', 'standard', 1237, 608, 69, 55),
    (v_conf_id, '309', 'standard', 1305, 608, 69, 55),

    (v_conf_id, '400', 'standard', 1029, 663, 69, 55),
    (v_conf_id, '402', 'standard', 1099, 663, 69, 55),
    (v_conf_id, '404', 'standard', 1166, 663, 69, 55),
    (v_conf_id, '406', 'standard', 1235, 663, 69, 55),
    (v_conf_id, '408', 'standard', 1304, 663, 69, 55),

    (v_conf_id, '403', 'standard', 1099, 775, 69, 55),
    (v_conf_id, '405', 'standard', 1167, 775, 69, 55),
    (v_conf_id, '407', 'standard', 1236, 775, 69, 55),
    (v_conf_id, '409', 'standard', 1304, 775, 69, 55),

    (v_conf_id, '502', 'standard', 1099, 830, 69, 55),
    (v_conf_id, '504', 'standard', 1167, 830, 69, 55),
    (v_conf_id, '506', 'standard', 1236, 830, 69, 55),
    (v_conf_id, '508', 'standard', 1305, 830, 69, 55),

    (v_conf_id, '714', 'standard', 1428, 742,  55, 69),
    (v_conf_id, '716', 'standard', 1428, 810,  55, 69),
    (v_conf_id, '718', 'standard', 1428, 879,  55, 69)

  on conflict (conference_id, booth_number) do nothing;

  -- ── Booth products ──────────────────────────────────────────────────────────

  insert into public.conference_products (
    conference_id, slug, name, description,
    price_cents, is_taxable, capacity, max_per_account,
    display_order, is_active, metadata
  ) values (
    v_conf_id,
    'annual_partnership_bundle',
    'CSC Annual Partnership (2026–27)',
    'Campus Stores Canada annual partnership for vendors — required for conference participation. Bundled automatically if your organization does not hold a current partnership.',
    50000,
    true,
    null,
    1,
    0,
    true,
    '{"booth_system": true, "hidden_from_catalog": true}'::jsonb
  )
  on conflict do nothing
  returning id into v_partner_id;

  insert into public.conference_products (
    conference_id, slug, name, description,
    price_cents, is_taxable, capacity, max_per_account,
    display_order, is_active, metadata
  ) values (
    v_conf_id,
    'exhibitor_booth_standard',
    'Standard Exhibitor Booth',
    'Trade show floor access. Includes: 8''×10'' booth space, one 6''×2'' table, two chairs, meals during trade show hours, one networking session pass.',
    400000,
    true,
    null,
    1,
    10,
    true,
    '{"booth_system": true, "zone": "standard"}'::jsonb
  )
  on conflict do nothing
  returning id into v_std_id;

  insert into public.conference_products (
    conference_id, slug, name, description,
    price_cents, is_taxable, capacity, max_per_account,
    display_order, is_active, metadata
  ) values (
    v_conf_id,
    'exhibitor_booth_connected',
    'Connected Exhibitor Booth',
    'Premium trade show location with a full day of pre-scheduled buyer meetings. Includes everything in Standard plus structured meeting schedule.',
    550000,
    true,
    null,
    1,
    11,
    true,
    '{"booth_system": true, "zone": "connected"}'::jsonb
  )
  on conflict do nothing
  returning id into v_con_id;

  insert into public.conference_products (
    conference_id, slug, name, description,
    price_cents, is_taxable, capacity, max_per_account,
    display_order, is_active, metadata
  ) values (
    v_conf_id,
    'networking_session_ticket',
    'Additional Networking Session Pass',
    'Extra attendee pass for the networking session. One pass is included free with each booth purchase; additional passes are $200/person.',
    20000,
    true,
    null,
    null,
    20,
    true,
    '{}'::jsonb
  )
  on conflict do nothing
  returning id into v_network_id;

  -- ── Product rules ───────────────────────────────────────────────────────────

  if v_std_id is not null then
    insert into public.conference_product_rules
      (product_id, rule_type, rule_config, error_message, display_order)
    values
      (
        v_std_id,
        'requires_org_type',
        '{"org_types": ["vendor_partner", "Vendor Partner"]}'::jsonb,
        'Standard exhibitor booths are available to vendor partners only.',
        1
      ),
      (
        v_std_id,
        'max_quantity',
        '{"max": 1}'::jsonb,
        'You may only purchase one booth per organization.',
        2
      )
    on conflict do nothing;
  end if;

  if v_con_id is not null then
    insert into public.conference_product_rules
      (product_id, rule_type, rule_config, error_message, display_order)
    values
      (
        v_con_id,
        'requires_org_type',
        '{"org_types": ["vendor_partner", "Vendor Partner"]}'::jsonb,
        'Connected exhibitor booths are available to vendor partners only.',
        1
      ),
      (
        v_con_id,
        'max_quantity',
        '{"max": 1}'::jsonb,
        'You may only purchase one booth per organization.',
        2
      )
    on conflict do nothing;
  end if;

  if v_network_id is not null then
    insert into public.conference_product_rules
      (product_id, rule_type, rule_config, error_message, display_order)
    values
      (
        v_network_id,
        'requires_product',
        jsonb_build_object('product_slugs', jsonb_build_array(
          'exhibitor_booth_standard', 'exhibitor_booth_connected'
        )),
        'Networking passes require an active booth purchase.',
        1
      )
    on conflict do nothing;
  end if;

  raise notice 'Seeded % booths and booth products for conference %.',
    (select count(*) from public.conference_booths where conference_id = v_conf_id),
    v_conf_id;
end;
$$;
