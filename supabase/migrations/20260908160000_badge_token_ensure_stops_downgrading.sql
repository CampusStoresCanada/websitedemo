-- `ensure_conference_badge_token_for_person` was not ensuring, it was OVERWRITING.
--
-- ⛔ Its ON CONFLICT branch unconditionally set `token_format = 'person_uuid'`
-- and rewrote `token_hash` to sha256(person_id). Because there is a UNIQUE index
-- on (conference_id, person_id) — one token row per person, permanently — every
-- caller of this function DOWNGRADED whatever token that person already had.
--
-- What that broke, in order of severity:
--
--   1. The person's printed badge stopped resolving. A modern badge encodes
--      /scan/<hmac token>, and lookup is by sha256(token); after the rewrite the
--      stored hash is sha256(person_id), which that token can never produce. The
--      badge reads as `invalid_token` at the desk AND at the public scan route.
--   2. Every badge job for the WHOLE conference stopped rendering, because the
--      document builder treated the legacy row as "needs minting", tried to
--      insert a second row, and hit the unique index. One person, no PDFs for
--      anybody. (The builder now upgrades in place, so this one is fixed on both
--      sides.)
--
-- The callers are an on-site reprint and the check-in desk's bare-UUID fallback,
-- so the trigger is ordinary desk work: reprint one damaged badge, or scan one
-- old-format badge, and that attendee's real badge is dead.
--
-- ⛔ An "ensure" must be idempotent. If the row exists, keep its token: the app
-- layer owns token format, because deriving an hmac_v1 token needs the service
-- key, which Postgres does not have. This function's only remaining job is to
-- guarantee a row EXISTS for a person, so the renderer has an id to derive from.
--
-- ⚠️ Reprinting a REVOKED badge has no defined behaviour and this does not
-- invent one. Nothing in the badge pipeline revokes a token today (the only
-- `revoked_at` writes in the app are elections proxies), so the un-revoke below
-- is kept exactly as it was rather than quietly changing what a reprint means.

create or replace function public.ensure_conference_badge_token_for_person(
  p_conference_id uuid,
  p_person_id uuid,
  p_actor_id uuid default null
)
returns table(token_id uuid, qr_payload text)
language plpgsql
set search_path to 'public', 'extensions'
as $function$
declare
  v_token_id uuid;
begin
  insert into public.conference_badge_tokens (
    conference_id,
    person_id,
    token_hash,
    created_by,
    token_format,
    revoked_at,
    revoked_by
  )
  values (
    p_conference_id,
    p_person_id,
    -- A placeholder for a person who has no row at all. The next render
    -- upgrades it to a derived token; nothing prints from this value.
    encode(digest(p_person_id::text, 'sha256'), 'hex'),
    p_actor_id,
    'person_uuid',
    null,
    null
  )
  on conflict (conference_id, person_id)
  -- ⛔ token_hash and token_format are deliberately NOT in this list.
  do update set
    revoked_at = null,
    revoked_by = null
  returning id into v_token_id;

  return query
  select v_token_id, p_person_id::text;
end;
$function$;
