-- Chunk 12 follow-up: per-attempt wishlist billing log with Stripe references.

create table if not exists public.wishlist_billing_attempts (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conference_instances(id) on delete cascade,
  billing_run_id uuid references public.billing_runs(id) on delete set null,
  wishlist_intent_id uuid not null references public.wishlist_intents(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null references public.conference_products(id) on delete cascade,
  attempt_number integer not null default 1 check (attempt_number > 0),
  status text not null check (status in ('attempted','succeeded','failed','skipped')),
  amount_cents integer not null default 0 check (amount_cents >= 0),
  currency text not null default 'CAD',
  stripe_payment_intent_id text,
  stripe_charge_id text,
  stripe_error_code text,
  stripe_decline_code text,
  error_message text,
  metadata jsonb,
  attempted_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_wishlist_billing_attempts_conf
  on public.wishlist_billing_attempts(conference_id, attempted_at desc);
create index if not exists idx_wishlist_billing_attempts_run
  on public.wishlist_billing_attempts(billing_run_id, attempted_at desc);
create index if not exists idx_wishlist_billing_attempts_intent
  on public.wishlist_billing_attempts(wishlist_intent_id, attempted_at desc);

alter table public.wishlist_billing_attempts enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'wishlist_billing_attempts'
      and policyname = 'wishlist_billing_attempts_select_authenticated'
  ) then
    create policy wishlist_billing_attempts_select_authenticated
      on public.wishlist_billing_attempts
      for select
      to authenticated
      using (true);
  end if;
end
$$;
