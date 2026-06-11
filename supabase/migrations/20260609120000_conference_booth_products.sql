-- Conference Booth Products: seed exhibitor offerings for 2027 conference.
--
-- Pricing model:
--   $500  annual_partnership_bundle   — base CSC partnership (bundled if org lacks 2026-27 membership)
--   $4,000 exhibitor_booth_standard  — standard zone booth add-on
--   $5,500 exhibitor_booth_connected — connected zone booth add-on (incl. scheduled meeting day)
--   $200  networking_session_ticket  — extra networking attendee beyond the 1 included with booth
--
-- Total cost examples:
--   New vendor  + standard booth  = $500 + $4,000 = $4,500
--   Existing partner + connected  = $0   + $5,500 = $5,500
--   New vendor  + connected booth = $500 + $5,500 = $6,000
--
-- Capacity is enforced at the individual conference_booths row level (not here),
-- so capacity is NULL on the product rows.

do $$
declare
  v_conf_id       uuid;
  v_std_id        uuid;
  v_con_id        uuid;
  v_partner_id    uuid;
  v_network_id    uuid;
begin
  select id into v_conf_id
  from public.conference_instances
  where year = 2027 and edition_code = '00'
  limit 1;

  if v_conf_id is null then
    raise notice 'Conference 2027/00 not found — skipping booth product seed.';
    return;
  end if;

  -- ── Annual Partnership Bundle ─────────────────────────────────────────────
  -- Auto-bundled in checkout for orgs without a current 2026-27 partnership.
  -- NOT shown on the standard products page; managed by the booth purchase flow.
  insert into public.conference_products (
    conference_id, slug, name, description,
    price_cents, is_taxable, capacity, max_per_account,
    display_order, is_active, metadata
  ) values (
    v_conf_id,
    'annual_partnership_bundle',
    'CSC Annual Partnership (2026–27)',
    'Campus Stores Canada annual partnership for vendors — required for conference participation. Bundled automatically if your organization does not hold a current partnership.',
    50000,         -- $500.00
    true,
    null,          -- no product-level cap
    1,             -- one per org
    0,
    true,
    '{"booth_system": true, "hidden_from_catalog": true}'::jsonb
  )
  on conflict do nothing
  returning id into v_partner_id;

  -- ── Standard Exhibitor Booth ──────────────────────────────────────────────
  insert into public.conference_products (
    conference_id, slug, name, description,
    price_cents, is_taxable, capacity, max_per_account,
    display_order, is_active, metadata
  ) values (
    v_conf_id,
    'exhibitor_booth_standard',
    'Standard Exhibitor Booth',
    'Trade show floor access. Includes: 8''×10'' booth space, one 6''×2'' table, two chairs, meals during trade show hours, one networking session pass.',
    400000,        -- $4,000.00
    true,
    null,          -- enforced per-booth in conference_booths
    1,             -- one booth per org
    10,
    true,
    '{"booth_system": true, "zone": "standard"}'::jsonb
  )
  on conflict do nothing
  returning id into v_std_id;

  -- ── Connected Exhibitor Booth ─────────────────────────────────────────────
  insert into public.conference_products (
    conference_id, slug, name, description,
    price_cents, is_taxable, capacity, max_per_account,
    display_order, is_active, metadata
  ) values (
    v_conf_id,
    'exhibitor_booth_connected',
    'Connected Exhibitor Booth',
    'Premium trade show location with a full day of pre-scheduled buyer meetings. Includes everything in Standard plus structured meeting schedule.',
    550000,        -- $5,500.00
    true,
    null,
    1,
    11,
    true,
    '{"booth_system": true, "zone": "connected"}'::jsonb
  )
  on conflict do nothing
  returning id into v_con_id;

  -- ── Networking Session Ticket ─────────────────────────────────────────────
  insert into public.conference_products (
    conference_id, slug, name, description,
    price_cents, is_taxable, capacity, max_per_account,
    display_order, is_active, metadata
  ) values (
    v_conf_id,
    'networking_session_ticket',
    'Additional Networking Session Pass',
    'Extra attendee pass for the networking session. One pass is included free with each booth purchase; additional passes are $200/person.',
    20000,         -- $200.00
    true,
    null,
    null,          -- no cap — buy as many as needed
    20,
    true,
    '{}'::jsonb
  )
  on conflict do nothing
  returning id into v_network_id;

  -- ── Product Rules ─────────────────────────────────────────────────────────

  -- Standard booth: vendor_partner orgs only
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

  -- Connected booth: vendor_partner orgs only
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

  -- Networking ticket: requires a booth purchase (either zone)
  if v_network_id is not null and v_std_id is not null and v_con_id is not null then
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

  raise notice 'Booth products seeded for conference 2027/00.';
end;
$$;
