-- A space rule can now point at a Google group, and can select people by the
-- governance role they hold.
--
-- `circle_space_rules` already answers "who belongs in this destination, kept
-- in step on a schedule" — one row per destination, a kind discriminator, an
-- admin screen and last_run telemetry. Membership of board@campusstores.ca is
-- the same question with a different store, so it becomes a row here rather
-- than a second system with its own table, cron and panel.
--
-- ⚠️ STRICTLY ADDITIVE. Prod and local share one database and an hourly job
-- reads this table, so every column is nullable or carries a default that
-- reproduces today's behaviour. Every existing row stays a circle_space rule
-- and keeps working untouched.
--
-- The table keeps its name. Renaming it to something store-neutral would be
-- tidier and would also rewrite code shipped four days ago for no behavioural
-- gain.

alter table circle_space_rules
  add column if not exists destination text not null default 'circle_space',
  add column if not exists google_group_email text,
  add column if not exists body_key text,
  add column if not exists role_key text;

-- A Circle rule needs a space; a Google rule needs a group address.
alter table circle_space_rules alter column space_id drop not null;

alter table circle_space_rules
  drop constraint if exists circle_space_rules_destination_target;
alter table circle_space_rules
  add constraint circle_space_rules_destination_target check (
    (destination = 'circle_space' and space_id is not null)
    or (destination = 'google_group' and google_group_email is not null)
  );

-- ⚠️ The existing kind check allowed exactly two values, so a governance_role
-- row would have been rejected by the database however well the code handled
-- it. Replaced rather than added to: two overlapping checks on one column is
-- how you get a row that satisfies one and not the other.
alter table circle_space_rules
  drop constraint if exists circle_space_rules_kind_check;
alter table circle_space_rules
  add constraint circle_space_rules_kind_check check (
    kind = any (array['conference_passes'::text, 'survey_answer'::text, 'governance_role'::text])
  );

-- Same for the per-kind field shape: it enumerated the two kinds exhaustively,
-- so the new one had to be written into it rather than alongside.
alter table circle_space_rules
  drop constraint if exists circle_space_rules_kind_fields;
alter table circle_space_rules
  add constraint circle_space_rules_kind_fields check (
    (kind = 'conference_passes' and conference_id is not null
       and survey_field is null and survey_value is null)
    or (kind = 'survey_answer' and conference_id is null and pass_entity_ids is null
       and survey_field is not null and survey_value is not null)
    or (kind = 'governance_role' and conference_id is null and pass_entity_ids is null
       and survey_field is null and survey_value is null
       and body_key is not null and role_key is not null)
  );

-- space_id was already UNIQUE; Postgres permits many NULLs, so Google rules do
-- not collide. A group address gets the same one-rule-per-destination rule.
create unique index if not exists circle_space_rules_google_group_email_key
  on circle_space_rules (google_group_email)
  where google_group_email is not null;

comment on column circle_space_rules.destination is
  'circle_space | google_group — which store this rule keeps in step.';
comment on column circle_space_rules.body_key is
  'governance_bodies.key, for a governance_role rule.';
comment on column circle_space_rules.role_key is
  'governance_role_assignments.role_key, for a governance_role rule.';
