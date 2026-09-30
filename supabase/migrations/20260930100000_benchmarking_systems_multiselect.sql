-- §9: a store runs more than one system, so ask for all of them.
--
-- Stores were picking the one POS they would name if forced, which is why the
-- free-text era produced "Prism / Bookware (migrating)" in a single box. A
-- text[] lets them say both, and the type-and-Enter escape records a system our
-- list is missing instead of refusing it.
--
-- The 39-40 FY2025 answers become one-element arrays, not nulls. Their
-- spellings are left exactly as the stores wrote them: deciding that "Oracle
-- Netsuite" meant "NetSuite" is the store's call to make when it files, not
-- ours to make on its behalf in a migration.

alter table public.benchmarking
  alter column pos_system type text[]
    using case when pos_system is null then null else array[pos_system::text] end,
  alter column ebook_delivery_system type text[]
    using case when ebook_delivery_system is null then null else array[ebook_delivery_system::text] end,
  alter column student_info_system type text[]
    using case when student_info_system is null then null else array[student_info_system::text] end,
  alter column lms_system type text[]
    using case when lms_system is null then null else array[lms_system::text] end;

comment on column public.benchmarking.pos_system is
  'Select all that apply. A store mid-migration genuinely runs two.';
