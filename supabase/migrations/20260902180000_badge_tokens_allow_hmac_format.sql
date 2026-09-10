-- Badge scan tokens: allow the derivable format.
--
-- The badge QR previously encoded `conference_people.id` verbatim, which is
-- what `token_format = 'person_uuid'` records. That meant a phone camera had no
-- URL to open, the printed code was a live primary key, and it could not be
-- revoked without reprinting the badge.
--
-- Badges now carry a token derived by HMAC from the token row's own id (see
-- lib/conference/badges/tokens.ts): reproducible across reprints, never stored
-- in plaintext, and revoked by `revoked_at` plus a fresh row. The existing check
-- constraint pinned the column to the single legacy value, so inserting the new
-- format failed. Legacy rows keep their format and are simply not used to print.

alter table conference_badge_tokens
  drop constraint if exists conference_badge_tokens_token_format_check;

alter table conference_badge_tokens
  add constraint conference_badge_tokens_token_format_check
  check (token_format in ('person_uuid', 'hmac_v1'));
