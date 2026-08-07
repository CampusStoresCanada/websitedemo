create or replace function public.record_delivery_open(p_delivery_id uuid)
returns void
language plpgsql
set search_path to 'public'
as $$
begin
  update message_deliveries
  set opened_at = coalesce(opened_at, now()),
      open_count = open_count + 1
  where id = p_delivery_id;
end;
$$;

create or replace function public.record_delivery_click(p_delivery_id uuid, p_campaign_id uuid, p_url text)
returns void
language plpgsql
set search_path to 'public'
as $$
begin
  update message_deliveries
  set first_clicked_at = coalesce(first_clicked_at, now()),
      click_count = click_count + 1
  where id = p_delivery_id;

  insert into message_link_clicks (delivery_id, campaign_id, url)
  values (p_delivery_id, p_campaign_id, p_url);
end;
$$;
