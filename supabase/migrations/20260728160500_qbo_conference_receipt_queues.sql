-- Conference commerce (booths/registration/sponsorship) never touches the
-- `invoices` table — process_conference_order_paid() settles entirely inside
-- conference_orders/conference_order_items/entity_purchases — so it's
-- invisible to the existing qbo_export_queue pipeline (which only handles
-- paid `invoices` rows as Invoice+Payment). These two queues are a parallel,
-- conference-specific path that posts a QuickBooks Sales Receipt per paid
-- order instead (no AR — money's already collected via Stripe), with a
-- matching Refund Receipt path for refunds. See lib/quickbooks/conference-export.ts.

create table if not exists public.qbo_conference_receipt_queue (
  id uuid primary key default gen_random_uuid(),
  conference_order_id uuid not null unique references public.conference_orders(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed', 'retrying')),
  retry_count integer not null default 0,
  max_retries integer not null default 3,
  next_retry_at timestamptz null,
  lease_expires_at timestamptz null,
  qbo_sales_receipt_id text null,
  error_message text null,
  processed_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists idx_qbo_conference_receipt_queue_claimable
  on public.qbo_conference_receipt_queue(status, next_retry_at);

-- stripe_refund_id is the idempotency key — a conference refund can be
-- triggered from two call sites today (the charge.refunded webhook AND the
-- admin manual-refund action both call process_conference_order_refund), so
-- this prevents double-posting a refund receipt for the same Stripe refund.
create table if not exists public.qbo_conference_refund_queue (
  id uuid primary key default gen_random_uuid(),
  conference_order_id uuid not null references public.conference_orders(id) on delete cascade,
  stripe_refund_id text not null unique,
  refund_amount_cents integer not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed', 'retrying')),
  retry_count integer not null default 0,
  max_retries integer not null default 3,
  next_retry_at timestamptz null,
  lease_expires_at timestamptz null,
  qbo_refund_receipt_id text null,
  error_message text null,
  processed_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists idx_qbo_conference_refund_queue_claimable
  on public.qbo_conference_refund_queue(status, next_retry_at);

create index if not exists idx_qbo_conference_refund_queue_order
  on public.qbo_conference_refund_queue(conference_order_id);

alter table public.qbo_conference_receipt_queue enable row level security;
alter table public.qbo_conference_refund_queue enable row level security;

grant select, insert, update on public.qbo_conference_receipt_queue to authenticated;
grant select, insert, update on public.qbo_conference_refund_queue to authenticated;

-- RLS is a defense-in-depth backstop — the actual worker/enqueue functions
-- use the service-role admin client. Mirrors conference_scheduled_transitions'
-- admin-role read policy shape.
drop policy if exists qbo_conference_receipt_queue_admin_read
  on public.qbo_conference_receipt_queue;
create policy qbo_conference_receipt_queue_admin_read
  on public.qbo_conference_receipt_queue
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.global_role in ('admin', 'super_admin')
    )
  );

drop policy if exists qbo_conference_refund_queue_admin_read
  on public.qbo_conference_refund_queue;
create policy qbo_conference_refund_queue_admin_read
  on public.qbo_conference_refund_queue
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.global_role in ('admin', 'super_admin')
    )
  );
