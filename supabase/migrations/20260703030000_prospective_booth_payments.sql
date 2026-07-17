-- Supports "pay first, apply second" for a non-member buying a booth: they
-- pay before an application exists (no org, no user yet), then are routed
-- into the *existing* application pipeline (signup_applications, already
-- built) with a paid flag riding along — not a parallel approval system.
--
-- prospective_booth_payments is a holding record for the gap between
-- "Stripe succeeded" and "they actually came back to submit an application."
-- Without it, a real payment could go untracked if nobody ever finishes
-- applying.

create table if not exists public.prospective_booth_payments (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  company_name text not null,
  conference_id uuid not null references public.conference_instances(id) on delete cascade,
  booth_entity_id uuid not null references public.conference_entities(id) on delete cascade,
  amount_cents integer not null,
  stripe_checkout_session_id text not null unique,
  status text not null default 'pending' check (status in ('pending', 'paid', 'linked')),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  linked_application_id uuid references public.signup_applications(id) on delete set null
);

create index if not exists idx_prospective_booth_payments_email on public.prospective_booth_payments(email);

alter table public.signup_applications
  add column if not exists paid_at timestamptz,
  add column if not exists stripe_checkout_session_id text,
  add column if not exists paid_amount_cents integer,
  add column if not exists paid_for text,
  add column if not exists paid_booth_entity_id uuid references public.conference_entities(id) on delete set null,
  add column if not exists paid_conference_id uuid references public.conference_instances(id) on delete set null;
