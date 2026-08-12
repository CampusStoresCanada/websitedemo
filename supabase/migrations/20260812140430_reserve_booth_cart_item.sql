create or replace function public.reserve_booth_cart_item(
  p_conference_id uuid,
  p_organization_id uuid,
  p_user_id uuid,
  p_offer_entity_id uuid,
  p_expires_at timestamptz,
  p_max_booths int default 4
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_conflict_org_name text;
  v_existing_id uuid;
  v_active_booth_count int;
begin
  -- Serialize on the booth being reserved (closes the cross-org double-hold
  -- race) and separately on the buying org (closes the same-org race where
  -- two of an org's own concurrent add-to-cart calls could both read the
  -- cap as not-yet-hit). Both locks release automatically at commit.
  perform pg_advisory_xact_lock(hashtext(p_offer_entity_id::text));
  perform pg_advisory_xact_lock(hashtext(p_organization_id::text || ':booth_cap'));

  select o.name into v_conflict_org_name
  from cart_items ci
  join organizations o on o.id = ci.organization_id
  where ci.conference_id = p_conference_id
    and ci.offer_entity_id = p_offer_entity_id
    and ci.organization_id <> p_organization_id
    and ci.expires_at is not null
    and ci.expires_at > now()
  limit 1;

  if v_conflict_org_name is not null then
    return jsonb_build_object('success', false, 'code', 'BOOTH_RESERVED', 'org_name', v_conflict_org_name);
  end if;

  select id into v_existing_id
  from cart_items
  where conference_id = p_conference_id
    and organization_id = p_organization_id
    and user_id = p_user_id
    and offer_entity_id = p_offer_entity_id;

  -- Refreshing an already-held booth's reservation doesn't count against
  -- the cap — only count OTHER distinct booths currently held.
  if v_existing_id is null then
    select count(*) into v_active_booth_count
    from cart_items ci
    join conference_entities ce on ce.id = ci.offer_entity_id
    where ci.conference_id = p_conference_id
      and ci.organization_id = p_organization_id
      and ce.kind = 'booth'
      and (ci.expires_at is null or ci.expires_at > now());

    if v_active_booth_count >= p_max_booths then
      return jsonb_build_object('success', false, 'code', 'TOO_MANY_BOOTHS', 'max', p_max_booths);
    end if;
  end if;

  if v_existing_id is not null then
    update cart_items
    set expires_at = p_expires_at, updated_at = now()
    where id = v_existing_id;
    return jsonb_build_object('success', true, 'cart_item_id', v_existing_id);
  else
    insert into cart_items(conference_id, organization_id, user_id, offer_entity_id, quantity, expires_at, metadata)
    values (p_conference_id, p_organization_id, p_user_id, p_offer_entity_id, 1, p_expires_at, null)
    returning id into v_existing_id;
    return jsonb_build_object('success', true, 'cart_item_id', v_existing_id);
  end if;
end;
$$;
