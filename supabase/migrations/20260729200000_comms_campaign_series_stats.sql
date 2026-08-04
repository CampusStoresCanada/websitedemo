create or replace view public.message_campaign_series as
select
  series_key,
  series_label,
  count(distinct campaign_id) as send_count,
  min(campaign_created_at) as first_sent_at,
  max(campaign_last_activity_at) as last_sent_at,
  count(delivery_id) as total_deliveries,
  count(*) filter (where delivery_status in ('sent', 'delivered')) as sent_count,
  count(*) filter (where delivery_status = 'delivered') as delivered_count,
  count(*) filter (where open_count > 0) as opened_count,
  count(*) filter (where click_count > 0) as clicked_count,
  count(*) filter (where delivery_status in ('bounced', 'failed')) as failed_count,
  count(*) filter (where delivery_status = 'complained') as complained_count
from (
  select
    c.id as campaign_id,
    coalesce(c.template_id::text, 'name:' || c.name) as series_key,
    coalesce(t.name, c.name) as series_label,
    c.created_at as campaign_created_at,
    coalesce(c.completed_at, c.sent_at, c.created_at) as campaign_last_activity_at,
    d.id as delivery_id,
    d.status as delivery_status,
    d.open_count,
    d.click_count
  from message_campaigns c
  left join message_templates t on t.id = c.template_id
  left join message_deliveries d on d.campaign_id = c.id
  where c.status in ('completed', 'failed', 'sending')
) sub
group by series_key, series_label;
