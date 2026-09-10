-- A permanent, printable pointer to an organization.
--
-- The printed directory is a snapshot; a QR code on each listing turns it into
-- a pointer, so the book stays useful long after it is frozen — current
-- catalogue, current contact, ordering after the show. That is the difference
-- between a four-day artifact and one that earns its place until the next
-- edition is built.
--
-- Deliberately NOT share_links: those require an `expires_at` and count uses,
-- which is correct for sending someone a temporary link and catastrophic on
-- paper. A printed QR must still work when the paper outlives every assumption
-- we made about it.
--
-- Deliberately NOT the org slug either: slugs are editable and get renamed, and
-- a rename would silently kill every QR already in print.
--
-- 8 uppercase hex characters: ~4.3 billion values, no visually ambiguous
-- glyphs (no O/0 or I/l confusion), and short enough to keep the QR sparse and
-- scannable at small print sizes.

alter table public.organizations
  add column if not exists public_code text;

create unique index if not exists organizations_public_code_key
  on public.organizations (public_code)
  where public_code is not null;

comment on column public.organizations.public_code is
  'Permanent short code for printed QR codes (/e/<code>). Never reuse or change one that has been printed.';

-- Backfill every org that does not have one. Retried per-row uniqueness is
-- unnecessary at 8 hex chars, but the unique index is the real guarantee.
update public.organizations
set public_code = upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8))
where public_code is null;
