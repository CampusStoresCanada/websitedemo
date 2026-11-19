-- The audit log is append-only by construction, not by convention.
--
-- Before this, "append-only" was a claim in comments. `authenticated` was never
-- granted UPDATE or DELETE, so no signed-in person could rewrite a row -- but
-- RLS does not bind `service_role`, and every write in this codebase goes
-- through the admin client. One stray `.update()`, or a statement run by hand,
-- could silently alter the record a regulator would ask for.
--
-- A trigger is the only thing that binds service_role. Nothing in the codebase
-- updates or deletes audit_log today (22 call sites, every one an insert or a
-- select), so this breaks no path; it closes the one that was never written.
--
-- Retention: CSC keeps governance and audit entries SEVEN YEARS. Nothing purges
-- this table, so retention is satisfied by refusing to delete. The guard below
-- is what makes that refusal real rather than a habit.
--
-- Corrections are NEW ENTRIES. A wrong entry stays, and the correct fact is
-- appended after it, so a reader can see that a correction happened instead of
-- finding a tidied record and no evidence of the tidying.
--
-- The function is deliberately NOT security definer: it needs no privilege, it
-- only refuses. `create or replace trigger` keeps this re-runnable.

create or replace function public.reject_append_only_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception
    '% is append-only: % is not permitted. Append a correcting entry instead.',
    tg_table_name, tg_op
    using errcode = 'restrict_violation',
          hint = 'Insert a new row recording the correction; never alter or remove the original.';
end;
$$;

comment on function public.reject_append_only_mutation() is
  'Trigger guard for append-only ledgers. Binds service_role, which RLS does not. Applied to audit_log; reusable for any table whose contract is insert-and-read.';

create or replace trigger audit_log_no_update
  before update on public.audit_log
  for each row
  execute function public.reject_append_only_mutation();

create or replace trigger audit_log_no_delete
  before delete on public.audit_log
  for each row
  execute function public.reject_append_only_mutation();

-- A row-level trigger never fires for TRUNCATE, which would empty the table
-- without touching a single row.
create or replace trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement
  execute function public.reject_append_only_mutation();

comment on table public.audit_log is
  'Append-only audit ledger. Enforced by triggers, not convention: UPDATE, DELETE and TRUNCATE all raise. Retained seven years; corrections are appended as new entries.';
