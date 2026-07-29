-- Membership/partnership invoice refunds never had any QBO counterpart —
-- processRefund (admin-triggered) and processRefundUpdate (webhook-driven,
-- charge.refunded) both flip the local invoice to refunded_* but the original
-- QB Invoice+Payment stayed untouched. This queue posts a matching Refund
-- Receipt, mirroring qbo_conference_refund_queue. stripe_refund_id is the
-- idempotency key — the same refund can be enqueued from either call site.
-- See lib/quickbooks/export.ts's quickbooksExportRefundRun().

create table if not exists public.qbo_membership_refund_queue (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
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

create index if not exists idx_qbo_membership_refund_queue_claimable
  on public.qbo_membership_refund_queue(status, next_retry_at);

create index if not exists idx_qbo_membership_refund_queue_invoice
  on public.qbo_membership_refund_queue(invoice_id);

alter table public.qbo_membership_refund_queue enable row level security;

grant select, insert, update on public.qbo_membership_refund_queue to authenticated;

drop policy if exists qbo_membership_refund_queue_admin_read on public.qbo_membership_refund_queue;
create policy qbo_membership_refund_queue_admin_read
  on public.qbo_membership_refund_queue
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.global_role in ('admin', 'super_admin')
    )
  );
