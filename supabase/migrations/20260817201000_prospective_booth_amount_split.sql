-- The prospective-booth checkout sells two different supplies in one payment:
-- a booth (destination-based, taxed where the conference is held) and first-
-- year partnership dues (origin-based, taxed at the buyer's own province).
-- amount_cents stored only their SUM, so every downstream consumer had to
-- guess a single treatment for the lump — and the QBO misc-receipt worker
-- guessed the conference's, booking 13% ON HST on an Alberta partner's dues
-- that should have been 5% GST.
--
-- Storing the split at checkout time rather than re-deriving it later from
-- conference_entities.price_cents: booth prices are editable in the Build tab,
-- so a re-derivation months after the sale can silently disagree with what was
-- actually charged.

alter table public.prospective_booth_payments
  add column if not exists booth_amount_cents integer,
  add column if not exists membership_amount_cents integer;

-- Backfill the existing rows. Safe to derive here specifically because no
-- booth price has changed since these two sales (verified against the Stripe
-- checkout sessions): booth = its entity's current price, dues = the
-- remainder. The NOT NULL below is the guard — if any row fails to derive,
-- the whole migration rolls back rather than leaving a half-populated table.
update public.prospective_booth_payments p
set booth_amount_cents = e.price_cents,
    membership_amount_cents = p.amount_cents - e.price_cents
from public.conference_entities e
where e.id = p.booth_entity_id
  and p.booth_amount_cents is null
  and e.price_cents is not null
  and p.amount_cents >= e.price_cents;

alter table public.prospective_booth_payments
  alter column booth_amount_cents set not null,
  alter column membership_amount_cents set not null;

alter table public.prospective_booth_payments
  add constraint prospective_booth_payments_amount_split_ck
  check (booth_amount_cents + membership_amount_cents = amount_cents);

comment on column public.prospective_booth_payments.booth_amount_cents is
  'Pre-tax booth portion. Taxed at the conference rate (destination-based).';
comment on column public.prospective_booth_payments.membership_amount_cents is
  'Pre-tax first-year dues portion. Taxed at the buyer''s own province (origin-based).';

-- One existing row predates province collection on this form. Its org exists
-- now, so take the province from there rather than leaving the QBO export
-- unable to resolve a dues tax code for it.
update public.prospective_booth_payments p
set province = o.province
from public.organizations o
where lower(o.name) = lower(p.company_name)
  and p.province is null
  and o.province is not null;
