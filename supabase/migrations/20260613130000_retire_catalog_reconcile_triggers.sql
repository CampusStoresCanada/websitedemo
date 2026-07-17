-- Conference v2 Phase 5f: retire the config_json → catalog projection.
--
-- The catalog tables (conference_days / offsite_events / meal_services /
-- education_sessions) are now edited DIRECTLY by the Describe editor
-- (lib/actions/conference-catalog.ts) — they are the source of truth. The
-- reconcile triggers existed only for the transition while the legacy wizard
-- owned config_json; with the wizard retired they would clobber direct edits
-- by re-projecting stale config_json, so they are removed.
--
-- reconcile_conference_catalog() and link_legacy_entitlement_seats() are kept
-- as callable functions (one-off migration/backfill tools) but no longer fire
-- automatically.

drop trigger if exists reconcile_catalog_on_module_change on public.conference_schedule_modules;
drop trigger if exists reconcile_catalog_on_instance_dates on public.conference_instances;

comment on function public.reconcile_conference_catalog(uuid) is
  'One-off config_json → catalog projection (id-preserving, additive-merge). No longer trigger-driven as of Phase 5f; the catalog tables are edited directly and are authoritative.';
