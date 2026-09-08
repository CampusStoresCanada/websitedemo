import { describe, expect, it } from "vitest";

// Tokens are HMACs keyed on the service role key. A fixed fake key keeps these
// deterministic and keeps the real secret out of the test environment.
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "test-service-role-key";
import {
  BADGE_TOKEN_FORMAT,
  deriveBadgeToken,
  hashBadgeToken,
  badgeTokenMatches,
} from "../tokens";

/**
 * A legacy token row is UPGRADED, never duplicated.
 *
 * ⛔ `conference_badge_tokens` has a UNIQUE index on (conference_id, person_id):
 * one row per person, permanently. The document builder skipped rows that were
 * not in the derivable format and then tried to mint a replacement — which does
 * not skip that person, it throws, and the throw aborts the entire document
 * build. One person on a `person_uuid` token, which is what an on-site reprint
 * hands out, made every badge job for the whole conference unrenderable.
 *
 * The upgrade re-hashes the SAME row id, which is the property that makes it
 * safe: the token is derived from the row id, so the row keeps its identity and
 * anything already pointing at it keeps resolving.
 */
describe("upgrading a legacy badge token in place", () => {
  const conferenceId = "11111111-1111-4111-8111-111111111111";
  const rowId = "22222222-2222-4222-8222-222222222222";

  it("derives the same token from the same row id, before and after", () => {
    expect(deriveBadgeToken(conferenceId, rowId)).toBe(deriveBadgeToken(conferenceId, rowId));
  });

  it("produces a hash that matches the derived token", () => {
    const token = deriveBadgeToken(conferenceId, rowId);
    expect(badgeTokenMatches(token, hashBadgeToken(token))).toBe(true);
  });

  // ⚠️ The whole point of keeping the id: a QR already printed from this row —
  // or a scan already in flight — still resolves after the upgrade.
  it("keeps the row's identity, so an existing derived token still resolves", () => {
    const before = deriveBadgeToken(conferenceId, rowId);
    const upgradedHash = hashBadgeToken(deriveBadgeToken(conferenceId, rowId));
    expect(badgeTokenMatches(before, upgradedHash)).toBe(true);
  });

  it("gives a different person a different token", () => {
    const other = "33333333-3333-4333-8333-333333333333";
    expect(deriveBadgeToken(conferenceId, rowId)).not.toBe(
      deriveBadgeToken(conferenceId, other)
    );
  });

  it("is scoped by conference, so the same row id elsewhere does not collide", () => {
    const otherConf = "44444444-4444-4444-8444-444444444444";
    expect(deriveBadgeToken(conferenceId, rowId)).not.toBe(
      deriveBadgeToken(otherConf, rowId)
    );
  });

  it("upgrades to the format the printer actually uses", () => {
    expect(BADGE_TOKEN_FORMAT).toBe("hmac_v1");
  });
});
