-- Supports "pay first, no application" for a non-member buying a Day Pass:
-- unlike a booth (which onboards a new Partner org and needs board approval),
-- a non-member day pass is just a one-off ticket — there is no org yet, but
-- there also isn't anything for the board to review. So this mints straight
-- through in the webhook, right after payment succeeds, rather than routing
-- through the existing signup_applications pipeline (mirrors the shape of
-- prospective_booth_payments, not its approval step).
--
-- Consent is captured here directly (accepted_document_types) rather than via
-- legal_acceptances, which requires a real auth user_id — one doesn't exist
-- yet for an anonymous registrant, and creating one just to record a consent
-- checkbox would be the wrong tool for the job.

create table if not exists public.prospective_registration_payments (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  first_name text not null,
  last_name text not null,
  organization_name text not null,
  job_title text,
  phone text,
  dietary_restrictions text,
  conference_id uuid not null references public.conference_instances(id) on delete cascade,
  offer_entity_id uuid not null references public.conference_entities(id) on delete cascade,
  amount_cents integer not null,
  stripe_checkout_session_id text not null unique,
  accepted_document_types text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'paid', 'minted')),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  minted_at timestamptz,
  organization_id uuid references public.organizations(id) on delete set null,
  conference_person_id uuid references public.conference_people(id) on delete set null
);

create index if not exists idx_prospective_registration_payments_email
  on public.prospective_registration_payments(email);

-- Mints a Day Pass (and whatever it bundles) for an org created via the
-- pay-first non-member registration flow. Mirrors mint_prospective_booth_purchase
-- exactly (same effective_includes expansion) — the 'booth' exclusion in the
-- final seat insert is a no-op here since a Day Pass's graph never includes one,
-- reusing the identical, already-proven body rather than a parallel one.
create or replace function public.mint_prospective_registration_purchase(
  p_conference_id uuid,
  p_organization_id uuid,
  p_registration_entity_id uuid,
  p_price_cents integer,
  p_buyer text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_purchase uuid;
begin
  insert into public.entity_purchases(conference_id, offer_entity_id, quantity, buyer, price_cents)
  values (p_conference_id, p_registration_entity_id, 1, p_buyer, p_price_cents)
  returning id into v_purchase;

  insert into public.entity_balances(conference_id, organization_id, purchase_id, entity_id, quantity)
  with recursive effective_includes as (
    select from_entity_id, to_entity_id, quantity
    from public.conference_entity_refs
    where role = 'includes' and conference_id = p_conference_id
    union all
    select inst.from_entity_id, er.to_entity_id, er.quantity
    from public.conference_entity_refs inst
    join public.conference_entity_refs er
      on er.from_entity_id = inst.to_entity_id and er.role = 'includes' and er.conference_id = p_conference_id
    where inst.role = 'instance_of' and inst.conference_id = p_conference_id
      and not exists (
        select 1 from public.conference_entity_refs own
        where own.from_entity_id = inst.from_entity_id and own.role = 'includes' and own.to_entity_id = er.to_entity_id
      )
  ),
  exp(entity_id, qty) as (
    select p_registration_entity_id, 1
    union all
    select ei.to_entity_id, exp.qty * coalesce(ei.quantity, 1)
    from exp
    join effective_includes ei on ei.from_entity_id = exp.entity_id
  )
  select p_conference_id, p_organization_id, v_purchase, exp.entity_id, sum(exp.qty)
  from exp
  join public.conference_entities ce on ce.id = exp.entity_id
  where ce.kind not in ('day', 'item', 'meal', 'suite')
  group by exp.entity_id;

  insert into public.entity_balance_seats(conference_id, organization_id, balance_id, entity_id, seat_index)
  select b.conference_id, b.organization_id, b.id, b.entity_id, gs.i
  from public.entity_balances b
  join public.conference_entities ce on ce.id = b.entity_id
  cross join lateral generate_series(1, greatest(b.quantity, 1)) gs(i)
  where b.purchase_id = v_purchase
    and ce.kind <> 'booth';

  return v_purchase;
end;
$$;
