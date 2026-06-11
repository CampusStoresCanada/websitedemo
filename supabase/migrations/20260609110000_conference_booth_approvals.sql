-- Conference Booth Approvals: dual-admin queue before a card is charged.
--
-- Flow:
--   1. Buyer selects booth → reserve_booth() soft-holds it for 20 min
--   2. Buyer submits payment info (Stripe SetupIntent → saved payment method)
--   3. A row is inserted here with status='pending'
--   4. Admin 1 approves  → approver_1_id set, status stays 'pending'
--   5. Admin 2 approves  → approver_2_id set, status→'approved'
--      • For 'card' payments: charge fires immediately
--      • For 'po' payments:  charge fires at charge_after (submission + 30 days)
--   6. On Stripe success: status→'charged', confirm_booth_sale() called
--   7. Rejection by either admin: status→'rejected', booth hold released

create table if not exists public.conference_booth_approvals (
  id                        uuid        primary key default gen_random_uuid(),
  conference_id             uuid        not null references public.conference_instances(id),
  booth_id                  uuid        not null references public.conference_booths(id),
  organization_id           uuid        not null references public.organizations(id),
  submitted_by              uuid        not null references public.profiles(id),

  -- What's being purchased (filled by the purchase flow)
  line_items                jsonb       not null default '[]',
  subtotal_cents            integer     not null,
  tax_cents                 integer     not null default 0,
  total_cents               integer     not null,

  -- Payment method
  payment_type              text        not null check (payment_type in ('card', 'po')),
  stripe_customer_id        text,
  stripe_setup_intent_id    text,
  stripe_payment_method_id  text,
  po_number                 text,
  po_document_url           text,

  -- For PO: delay the actual charge 30 days from submission
  charge_after              timestamptz,

  -- Dual-admin approval
  status                    text        not null default 'pending'
                              check (status in (
                                'pending',    -- waiting for 2 approvals
                                'approved',   -- both approved, charge pending/scheduled
                                'rejected',   -- any admin rejected
                                'charged',    -- Stripe charge successful
                                'failed',     -- Stripe charge failed (retryable)
                                'refunded',   -- fully or partially refunded
                                'cancelled'   -- buyer withdrew or hold expired
                              )),

  approver_1_id             uuid        references public.profiles(id),
  approver_1_at             timestamptz,
  approver_2_id             uuid        references public.profiles(id),
  approver_2_at             timestamptz,

  rejected_by               uuid        references public.profiles(id),
  rejected_at               timestamptz,
  rejection_reason          text,

  -- Stripe charge outcome
  stripe_payment_intent_id  text,
  charged_at                timestamptz,
  charge_error              text,

  -- Refund tracking
  refund_amount_cents       integer,
  refunded_at               timestamptz,
  stripe_refund_id          text,

  -- Links to the resulting order (populated after charge succeeds)
  order_id                  uuid        references public.conference_orders(id),

  internal_notes            text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index if not exists idx_booth_approvals_conference
  on public.conference_booth_approvals(conference_id, status);

create index if not exists idx_booth_approvals_booth
  on public.conference_booth_approvals(booth_id);

create index if not exists idx_booth_approvals_org
  on public.conference_booth_approvals(organization_id);

create index if not exists idx_booth_approvals_pending
  on public.conference_booth_approvals(charge_after)
  where status = 'approved' and charge_after is not null;


-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.conference_booth_approvals enable row level security;

-- Buyers can read their own submissions
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'conference_booth_approvals'
      and policyname = 'booth_approvals_own_read'
  ) then
    create policy "booth_approvals_own_read"
      on public.conference_booth_approvals for select
      to authenticated
      using (submitted_by = auth.uid());
  end if;
end $$;

-- Buyers can insert their own submissions
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'conference_booth_approvals'
      and policyname = 'booth_approvals_own_insert'
  ) then
    create policy "booth_approvals_own_insert"
      on public.conference_booth_approvals for insert
      to authenticated
      with check (submitted_by = auth.uid());
  end if;
end $$;

-- Buyers can cancel their own pending submissions
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'conference_booth_approvals'
      and policyname = 'booth_approvals_own_cancel'
  ) then
    create policy "booth_approvals_own_cancel"
      on public.conference_booth_approvals for update
      to authenticated
      using (submitted_by = auth.uid() and status = 'pending')
      with check (status = 'cancelled');
  end if;
end $$;

-- Admins can read and update all
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'conference_booth_approvals'
      and policyname = 'booth_approvals_admin_all'
  ) then
    create policy "booth_approvals_admin_all"
      on public.conference_booth_approvals for all
      using (
        exists (
          select 1 from public.profiles
          where id = auth.uid()
            and global_role in ('admin', 'super_admin')
        )
      )
      with check (
        exists (
          select 1 from public.profiles
          where id = auth.uid()
            and global_role in ('admin', 'super_admin')
        )
      );
  end if;
end $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: submit_booth_approval_request
-- Called after the buyer completes the SetupIntent and submits the form.
-- Inserts the approval row and extends the booth hold to 48h (admin review window).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.submit_booth_approval_request(
  p_booth_id                uuid,
  p_org_id                  uuid,
  p_conference_id           uuid,
  p_line_items              jsonb,
  p_subtotal_cents          integer,
  p_tax_cents               integer,
  p_total_cents             integer,
  p_payment_type            text,    -- 'card' | 'po'
  p_stripe_customer_id      text     default null,
  p_stripe_setup_intent_id  text     default null,
  p_stripe_payment_method_id text    default null,
  p_po_number               text     default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_approval_id    uuid;
  v_booth_status   text;
  v_booth_org      uuid;
  v_charge_after   timestamptz;
begin
  -- Verify the booth is held by this org
  select status, organization_id
    into v_booth_status, v_booth_org
  from public.conference_booths
  where id = p_booth_id
  for update;

  if not found then
    raise exception 'booth_not_found';
  end if;

  if v_booth_status <> 'reserved' or v_booth_org <> p_org_id then
    raise exception 'booth_not_held_by_org';
  end if;

  -- For PO payments, charge fires 30 days after submission
  if p_payment_type = 'po' then
    v_charge_after := now() + interval '30 days';
  end if;

  insert into public.conference_booth_approvals (
    conference_id,
    booth_id,
    organization_id,
    submitted_by,
    line_items,
    subtotal_cents,
    tax_cents,
    total_cents,
    payment_type,
    stripe_customer_id,
    stripe_setup_intent_id,
    stripe_payment_method_id,
    po_number,
    charge_after
  ) values (
    p_conference_id,
    p_booth_id,
    p_org_id,
    auth.uid(),
    p_line_items,
    p_subtotal_cents,
    p_tax_cents,
    p_total_cents,
    p_payment_type,
    p_stripe_customer_id,
    p_stripe_setup_intent_id,
    p_stripe_payment_method_id,
    p_po_number,
    v_charge_after
  )
  returning id into v_approval_id;

  -- Extend the booth hold to give admins time to review (48h)
  update public.conference_booths
  set
    reserved_until = now() + interval '48 hours',
    updated_at     = now()
  where id = p_booth_id;

  return v_approval_id;
end;
$$;

grant execute on function public.submit_booth_approval_request(
  uuid, uuid, uuid, jsonb, integer, integer, integer, text, text, text, text, text
) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: approve_booth_request
-- Called by admin. Records each approval; when both are in, status→'approved'.
-- Returns: 'first_approval' | 'fully_approved' | 'already_approved' | 'not_found'
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.approve_booth_request(
  p_approval_id  uuid,
  p_notes        text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row          public.conference_booth_approvals%rowtype;
  v_admin_id     uuid := auth.uid();
begin
  -- Only admins
  if not exists (
    select 1 from public.profiles
    where id = v_admin_id
      and global_role in ('admin', 'super_admin')
  ) then
    raise exception 'permission_denied';
  end if;

  select * into v_row
  from public.conference_booth_approvals
  where id = p_approval_id
  for update;

  if not found or v_row.status <> 'pending' then
    return 'not_found';
  end if;

  -- Can't approve your own submission
  if v_row.approver_1_id = v_admin_id or v_row.approver_2_id = v_admin_id then
    return 'already_approved';
  end if;

  if v_row.approver_1_id is null then
    -- First approval
    update public.conference_booth_approvals
    set approver_1_id  = v_admin_id,
        approver_1_at  = now(),
        internal_notes = coalesce(p_notes, internal_notes),
        updated_at     = now()
    where id = p_approval_id;
    return 'first_approval';
  else
    -- Second approval — move to 'approved'
    update public.conference_booth_approvals
    set approver_2_id  = v_admin_id,
        approver_2_at  = now(),
        status         = 'approved',
        internal_notes = coalesce(p_notes, internal_notes),
        updated_at     = now()
    where id = p_approval_id;
    return 'fully_approved';
  end if;
end;
$$;

grant execute on function public.approve_booth_request(uuid, text) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: reject_booth_request
-- Called by admin. Releases the booth hold.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.reject_booth_request(
  p_approval_id   uuid,
  p_reason        text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row       public.conference_booth_approvals%rowtype;
  v_admin_id  uuid := auth.uid();
begin
  if not exists (
    select 1 from public.profiles
    where id = v_admin_id
      and global_role in ('admin', 'super_admin')
  ) then
    raise exception 'permission_denied';
  end if;

  select * into v_row
  from public.conference_booth_approvals
  where id = p_approval_id
  for update;

  if not found or v_row.status not in ('pending', 'approved') then
    return 'not_found';
  end if;

  update public.conference_booth_approvals
  set status           = 'rejected',
      rejected_by      = v_admin_id,
      rejected_at      = now(),
      rejection_reason = p_reason,
      updated_at       = now()
  where id = p_approval_id;

  -- Release the booth hold
  update public.conference_booths
  set status          = 'available',
      organization_id = null,
      reserved_at     = null,
      reserved_until  = null,
      updated_at      = now()
  where id = v_row.booth_id
    and status in ('reserved', 'sponsor_hold');

  return 'ok';
end;
$$;

grant execute on function public.reject_booth_request(uuid, text) to authenticated;
