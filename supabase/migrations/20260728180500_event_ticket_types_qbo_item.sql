-- Per-ticket-type QBO item mapping, same flat shape as the price-tier item
-- mapping used elsewhere (no type/instance inheritance needed — one row per
-- ticket type already). Only relevant to paid ticket types (price_cents > 0).
alter table public.event_ticket_types
  add column if not exists qbo_item_id text null;
