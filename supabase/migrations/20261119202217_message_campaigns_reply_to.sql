-- Campaigns send from a no-reply address, so a reply went nowhere. An optional
-- address per campaign that replies go to instead. Null keeps today's behaviour.
alter table public.message_campaigns
  add column if not exists reply_to text;

comment on column public.message_campaigns.reply_to is
  'Optional address replies go to. Null: no reply-to header, replies go to the no-reply sender.';
