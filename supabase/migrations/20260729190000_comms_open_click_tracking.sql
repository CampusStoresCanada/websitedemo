-- Chunk 22 Communications: open/click engagement tracking

alter table message_deliveries
  add column opened_at timestamptz,
  add column open_count integer not null default 0,
  add column first_clicked_at timestamptz,
  add column click_count integer not null default 0;

create table message_link_clicks (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references message_deliveries(id) on delete cascade,
  campaign_id uuid not null references message_campaigns(id) on delete cascade,
  url text not null,
  clicked_at timestamptz not null default now()
);

create index message_link_clicks_campaign_url_idx on message_link_clicks (campaign_id, url);
create index message_link_clicks_delivery_idx on message_link_clicks (delivery_id);

alter table message_link_clicks enable row level security;

create policy admin_read_link_clicks on message_link_clicks
  for select
  using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid()
        and p.global_role = any (array['admin', 'super_admin'])
    )
  );
