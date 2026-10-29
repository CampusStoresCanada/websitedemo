-- Addresses that belong in a rule's destination whatever the roster says.
--
-- board@campusstores.ca carries greg@campusstores.ca, info@campusstores.ca and
-- greg@mcphersonmanagement.com on purpose: one person is invited through three
-- addresses because otherwise he does not see it. None of that is derivable.
-- Two of the three are @campusstores.ca and were already treated as CSC's own
-- forwarders, so the third was the one surfacing as "on the list holding no
-- role" — and it would have surfaced on every run for ever, which is how a
-- report earns being ignored.
--
-- ⛔ DECLARED, never inferred. The alternative was to decide in code that three
-- addresses are one human, from a first name and a surname in a domain. That
-- is a person's call, and writing a guess here would make it permanent and
-- indistinguishable from something somebody actually said. A column somebody
-- typed into is a statement; an inference is not.
--
-- ⚠️ STRICTLY ADDITIVE, for the same reason as the migration that added
-- `destination`: prod and local share one database. Nullable, no default, no
-- change to any CHECK. Read only by groupRulesForBody(), which already filters
-- to destination = 'google_group' and kind = 'governance_role'; on every other
-- row it is inert, which is why it is not written into the per-kind field
-- check. Existing rows stay NULL and behave exactly as they do today.

alter table circle_space_rules
  add column if not exists always_members text[];

comment on column circle_space_rules.always_members is
  'Addresses that belong in this destination regardless of who holds the role: a shared inbox, a management company, a second address for one person. Never removed, and never reported as stale. Declared by hand at /admin/circle/spaces.';
