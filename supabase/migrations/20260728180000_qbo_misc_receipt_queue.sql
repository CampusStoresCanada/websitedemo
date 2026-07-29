-- Prospective booth payments, prospective (non-member) Day Pass registration
-- payments, and event ticket purchases are all the same shape for QBO export
-- purposes: money already collected via Stripe, no conference_orders/invoices
-- row backing them, one line item, needs one Sales Receipt. Rather than three
-- near-identical queue tables, one queue with a payment_kind discriminator —
-- see lib/quickbooks/conference-export.ts's quickbooksMiscReceiptExportRun().

create table if not exists public.qbo_misc_receipt_queue (
  id uuid primary key default gen_random_uuid(),
  payment_kind text not null check (payment_kind in ('prospective_booth', 'prospective_registration', 'event_ticket')),
  payment_id uuid not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed', 'retrying')),
  retry_count integer not null default 0,
  max_retries integer not null default 3,
  next_retry_at timestamptz null,
  lease_expires_at timestamptz null,
  qbo_sales_receipt_id text null,
  error_message text null,
  processed_at timestamptz null,
  created_at timestamptz not null default now(),
  unique (payment_kind, payment_id)
);

create index if not exists idx_qbo_misc_receipt_queue_claimable
  on public.qbo_misc_receipt_queue(status, next_retry_at);

alter table public.qbo_misc_receipt_queue enable row level security;

grant select, insert, update on public.qbo_misc_receipt_queue to authenticated;

-- RLS is a defense-in-depth backstop — the actual worker/enqueue functions
-- use the service-role admin client. Mirrors qbo_conference_receipt_queue's
-- admin-role read policy shape.
drop policy if exists qbo_misc_receipt_queue_admin_read on public.qbo_misc_receipt_queue;
create policy qbo_misc_receipt_queue_admin_read
  on public.qbo_misc_receipt_queue
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.global_role in ('admin', 'super_admin')
    )
  );
