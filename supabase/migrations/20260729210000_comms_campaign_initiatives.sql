create type comms_initiative_status as enum ('active', 'paused', 'ended');

create table comms_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  goal text,
  status comms_initiative_status not null default 'active',
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_comms_campaigns_updated_at
  before update on comms_campaigns
  for each row execute function set_updated_at();

alter table comms_campaigns enable row level security;

create policy admin_read_comms_campaigns on comms_campaigns
  for select
  using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.global_role = any (array['admin', 'super_admin'])
    )
  );

create policy admin_write_comms_campaigns on comms_campaigns
  for all
  using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.global_role = any (array['admin', 'super_admin'])
    )
  );

-- Templates can be forked into a campaign (own editable copy, doesn't
-- affect the library original or any other campaign) or created blank
-- directly inside one (campaign_id set, forked_from_template_id null).
alter table message_templates
  add column campaign_id uuid references comms_campaigns(id) on delete cascade,
  add column forked_from_template_id uuid references message_templates(id) on delete set null;

create index message_templates_campaign_id_idx on message_templates (campaign_id);

-- Each send knows which initiative (if any) it belongs to.
alter table message_campaigns
  add column campaign_id uuid references comms_campaigns(id) on delete set null;

create index message_campaigns_campaign_id_idx on message_campaigns (campaign_id);

-- Timestamped notes on a campaign, optionally tied to the specific email
-- that changed, so performance can be read before/after a tweak.
create table comms_campaign_milestones (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references comms_campaigns(id) on delete cascade,
  template_id uuid references message_templates(id) on delete set null,
  occurred_at timestamptz not null default now(),
  note text not null,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index comms_campaign_milestones_campaign_id_idx on comms_campaign_milestones (campaign_id);

alter table comms_campaign_milestones enable row level security;

create policy admin_read_comms_campaign_milestones on comms_campaign_milestones
  for select
  using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.global_role = any (array['admin', 'super_admin'])
    )
  );

create policy admin_write_comms_campaign_milestones on comms_campaign_milestones
  for all
  using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.global_role = any (array['admin', 'super_admin'])
    )
  );
