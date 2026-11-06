/**
 * The badge token row for each person: what every QR code for them is derived
 * from (deriveBadgeToken), on the printed badge and in the check-in email
 * alike.
 *
 * ⛔ ONE minting rule. A second one (a different id, a different format) would
 * produce a code that looks valid and scans to nothing. Moved here unchanged
 * from the badge document build so self check-in reuses it.
 *
 * Idempotent: a person who already has an active row keeps it, so the same QR
 * comes back every time. Reads the conference's rows whole rather than by
 * `.in(person_id)`, which fails past ~200 ids.
 */

import { randomUUID } from "crypto";
import { BADGE_TOKEN_FORMAT, deriveBadgeToken, hashBadgeToken } from "@/lib/conference/badges/tokens";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: string) => UUID.test(value);

export async function ensureBadgeTokenRowIds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- admin or service-role client
  db: any,
  conferenceId: string,
  personIds: string[]
): Promise<Map<string, string>> {
  const { data: tokenRows, error: tokenReadError } = await db
    .from("conference_badge_tokens")
    .select("id, person_id, token_format")
    .eq("conference_id", conferenceId)
    .is("revoked_at", null);
  // ⛔ A failed read must not look like "nobody has a token": minting would
  // then collide with every existing row.
  if (tokenReadError) throw new Error(`Could not read badge scan tokens: ${tokenReadError.message}`);

  // Row id -> person, for the tokens that already exist in the derivable format.
  const tokenRowIdByPerson = new Map<string, string>();
  // Person -> the row id of a token in an OLD format. There is a UNIQUE index on
  // (conference_id, person_id), so these cannot simply be skipped and re-minted:
  // see the upgrade below.
  const legacyTokenRowIdByPerson = new Map<string, string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const tokenRow of (tokenRows ?? []) as Record<string, any>[]) {
    const personId = tokenRow.person_id as string | null;
    const rowId = tokenRow.id as string | null;
    if (!personId || !isUuid(personId) || !rowId) continue;
    // Legacy `person_uuid` rows encoded the person's primary key on the badge.
    // Never printed as-is — a badge rendered today gets a real token — but they
    // are UPGRADED rather than ignored, because the person already occupies the
    // one row they are allowed.
    if (tokenRow.token_format !== BADGE_TOKEN_FORMAT) {
      legacyTokenRowIdByPerson.set(personId, rowId);
      continue;
    }
    tokenRowIdByPerson.set(personId, rowId);
  }

  // ⛔ Upgrade a legacy token IN PLACE. There is a UNIQUE index on
  // (conference_id, person_id) — one token row per person, permanently — so a
  // person holding a `person_uuid` row cannot be given a second, modern one.
  // Treating them as "needs minting" therefore did not skip them, it threw:
  //
  //     Could not mint badge scan tokens: duplicate key value violates unique
  //     constraint "idx_conference_badge_tokens_one_per_person"
  //
  // and that error aborts the WHOLE document build. One person on a legacy
  // token — which is what an on-site reprint hands out — made every badge job
  // for the entire conference unrenderable. Verified: the 13-person run failed
  // outright until this ran.
  //
  // The row id is what the token is derived from, so upgrading is a re-hash of
  // the SAME id: the row keeps its identity, and anything already pointing at
  // it keeps working.
  for (const [personId, rowId] of legacyTokenRowIdByPerson) {
    const { error: upgradeError } = await db
      .from("conference_badge_tokens")
      .update({
        token_format: BADGE_TOKEN_FORMAT,
        token_hash: hashBadgeToken(deriveBadgeToken(conferenceId, rowId)),
      })
      .eq("id", rowId);
    if (upgradeError) {
      throw new Error(
        `Could not upgrade a legacy badge token: ${upgradeError.message}`
      );
    }
    tokenRowIdByPerson.set(personId, rowId);
  }

  // Mint a token for anyone in this job who lacks one entirely. Idempotent: a
  // person who already has an active row keeps it, so a reprint reproduces the
  // same QR.
  const needTokens = [...new Set(personIds)].filter((id) => isUuid(id) && !tokenRowIdByPerson.has(id));
  if (needTokens.length > 0) {
    // The id is generated HERE, not by the database: the token is derived from
    // it, and `UNIQUE (conference_id, token_hash)` rules out inserting rows with
    // a placeholder hash and filling it in afterwards — the second row of any
    // batch would collide with the first.
    const pending = needTokens.map((personId) => {
      const rowId = randomUUID();
      return {
        id: rowId,
        conference_id: conferenceId,
        person_id: personId,
        token_format: BADGE_TOKEN_FORMAT,
        token_hash: hashBadgeToken(deriveBadgeToken(conferenceId, rowId)),
      };
    });
    const { error: mintError } = await db.from("conference_badge_tokens").insert(pending);
    if (mintError) {
      throw new Error(`Could not mint badge scan tokens: ${mintError.message}`);
    }
    for (const row of pending) tokenRowIdByPerson.set(row.person_id, row.id);
  }

  return tokenRowIdByPerson;
}
