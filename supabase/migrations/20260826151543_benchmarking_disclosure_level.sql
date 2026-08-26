-- Aggregate-only participation (launch plan §5B).
--
-- A store may contribute its figures to medians, counts and distributions
-- without ever appearing as a named row in anyone's comparison. By reciprocity
-- it also stops receiving named-peer detail: it sees itself against the
-- aggregate. This is not a penalty tier — granular detail requires reciprocity,
-- and a store that will not be named cannot expect to name others.
--
-- 'full' is the default because that is what every 2025 participant already
-- agreed to, and defaulting to the restrictive option would silently withdraw
-- 39 stores that never asked to be withdrawn.
--
-- Consent here is LIVE, not a gate at submission (§5D): a store may change this
-- at any point while the cycle is open, and everything downstream reads the
-- current value. The set_at/set_by columns exist so that a change is a record
-- of who decided what and when, rather than a value that silently differs from
-- what someone remembers agreeing to.
--
-- ⚠️ The column alone is not protection. A store that opts out is still
-- identifiable by subtraction if a peer cut names everyone else and publishes a
-- total. The suppression rules that make this real live in
-- lib/benchmarking/disclosure.ts and must be applied on every cut.
alter table public.benchmarking
  add column if not exists disclosure_level text not null default 'full',
  add column if not exists disclosure_level_set_at timestamptz,
  add column if not exists disclosure_level_set_by uuid references public.profiles(id);

alter table public.benchmarking
  drop constraint if exists benchmarking_disclosure_level_check;

alter table public.benchmarking
  add constraint benchmarking_disclosure_level_check
  check (disclosure_level in ('full', 'aggregate_only'));

comment on column public.benchmarking.disclosure_level is
  'full = may be shown as a named row to peers. aggregate_only = contributes to medians and counts but is never named, and receives no named-peer detail in return. Governs attribution only — never whether the figures count.';
comment on column public.benchmarking.disclosure_level_set_at is
  'When the store last chose. NULL means it has never been changed from the default.';

create index if not exists benchmarking_disclosure_level_idx
  on public.benchmarking (fiscal_year, disclosure_level)
  where disclosure_level <> 'full';
