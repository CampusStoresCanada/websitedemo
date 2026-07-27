-- Closes extension_in_public for pg_trgm. Its ~15 functions (gtrgm_*,
-- gin_extract_*_trgm, show_trgm, set_limit/show_limit) live directly and
-- unqualified in the public schema.
--
-- Verified unused before moving it: no index in the database uses
-- gin_trgm_ops/gist_trgm_ops (checked pg_indexes for any trigram opclass),
-- and no migration or app code calls similarity()/show_trgm()/the trigram
-- operators — the only references anywhere are the original
-- CREATE EXTENSION statement (20260513100000_page_snapshots.sql) and an
-- auto-generated RPC type entry that's never invoked. Safe to relocate
-- with zero behavior change; `extensions` already holds every other
-- non-core extension in this project (pgcrypto, uuid-ossp, vector).
--
-- NOT touching pg_net here (the other extension_in_public hit) — its
-- functions already live in a dedicated `net` schema regardless of what
-- pg_extension.extnamespace reports, so there's no real unqualified
-- exposure to close. It's also Supabase-managed with a background worker;
-- relocating it risks breakage for no real security gain.

ALTER EXTENSION pg_trgm SET SCHEMA extensions;
