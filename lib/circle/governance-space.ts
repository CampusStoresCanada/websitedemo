/**
 * Put the people holding a governance role into the Circle spaces that serve
 * it, take off the people who have stopped holding it, and read the membership
 * back to prove both.
 *
 * The sibling of `lib/google/governance-group.ts`, for the other destination a
 * `governance_role` rule can point at. ⛔ Both read who holds the role from
 * `roleAccessHolders`, so a door and the register can never disagree.
 *
 * ⛔ NOT on a schedule, for the reason the Google one is not: the board turns
 * over once a year, so polling Circle hourly is 8,760 calls to learn nothing
 * changed, and it moves the moment of truth away from the act. The hourly
 * conference job deliberately skips `governance_role` rules. This runs where
 * the decision is made — telling the winners — and reports to the person who
 * made it.
 *
 * ⚠️ Nothing is trusted. Circle answers 200 on an add that does not take, 422
 * on an add for somebody already there, and `create_space_group_member` claims
 * to add to every space in the group. All three are read back and diffed before
 * this reports success. A documented side effect is not evidence.
 *
 * ## The two surfaces
 *
 * A space GROUP is the sidebar heading; the SPACES are what you post in.
 * `is_hidden_from_non_members` is true on the Board of Directors group, so
 * somebody in both board spaces but not in the group cannot see either one.
 * Provisioning therefore ensures the group AND every space in it.
 *
 * ## ⛔ Moderator is not in here
 *
 * Circle's admin API has no update for a space member — POST and DELETE only —
 * so moderator cannot be set programmatically. It is reported as an outstanding
 * obligation rather than silently skipped. Measured 2026-11-26: of the twelve
 * real people in the board group, only two are moderators, and Carolyn Potter
 * is a moderator on the GROUP while not one in Board Stuff, so the flags are
 * tracked per surface and already disagree with each other.
 */

import { getCircleClient } from "@/lib/circle/client";
import { isCircleConfigured } from "@/lib/circle/config";
import { roleAccessHolders, roleEverHeldBy } from "@/lib/governance/role-access-holders";
import type { createAdminClient } from "@/lib/supabase/admin";

type Db = ReturnType<typeof createAdminClient>;


export type SpaceSyncOutcome = {
  label: string;
  spaceGroupId: number | null;
  /** The effective date every holder decision was made against. */
  asOf: string;
  /** Holders of the role as of `asOf`, by email. */
  wanted: string[];
  /** Emails added, per surface. */
  added: string[];
  /** Emails removed, per surface. */
  removed: string[];
  /** Holders with no Circle account — they cannot be added until they have one. */
  noCircleAccount: string[];
  /**
   * Read back AFTER the writes: emails that should be in and are still not.
   * Non-empty means the sync did not do what it reports, whatever Circle said.
   */
  stillMissing: string[];
  /** Moderator cannot be set through the API; these are the people to do by hand. */
  moderatorByHand: string[];
  problems: string[];
};

export type GovernanceSpaceRule = {
  id: string;
  label: string;
  bodyKey: string;
  roleKey: string;
  spaceId: number;
  /** On the list whatever the register says — staff and the Executive Director. */
  alwaysMembers: string[];
};

/**
 * The `governance_role` rules that point at a Circle space for this body.
 *
 * ⛔ The database has allowed this since `20261027210000`: the kind check lists
 * `governance_role` and the destination check only requires a `space_id` when
 * the destination is `circle_space`. Nothing needed a migration — the hourly
 * conference job just refused these rows with "a governance_role rule needs a
 * Google group destination", because no code had been written for them.
 */
export async function spaceRulesForBody(
  db: Db,
  bodyKey: string
): Promise<GovernanceSpaceRule[]> {
  const { data } = await db
    .from("circle_space_rules")
    .select("id, label, body_key, role_key, space_id, always_members")
    .eq("destination", "circle_space")
    .eq("kind", "governance_role")
    .eq("body_key", bodyKey);

  return (data ?? [])
    .filter((r) => r.space_id && r.body_key && r.role_key)
    .map((r) => ({
      id: r.id as string,
      label: r.label as string,
      bodyKey: r.body_key as string,
      roleKey: r.role_key as string,
      spaceId: Number(r.space_id),
      alwaysMembers: ((r.always_members as string[] | null) ?? []).map((e) => e.toLowerCase()),
    }));
}

function empty(label: string, asOf: string, problem: string): SpaceSyncOutcome {
  return {
    label,
    spaceGroupId: null,
    asOf,
    wanted: [],
    added: [],
    removed: [],
    noCircleAccount: [],
    stillMissing: [],
    moderatorByHand: [],
    problems: [problem],
  };
}

/** One line a person can read, for the screen that triggered this. */
export function describeSpaceOutcome(o: SpaceSyncOutcome): string {
  if (o.problems.length) return `${o.label}: ${o.problems.join("; ")}`;
  const bits: string[] = [];
  if (o.added.length) bits.push(`added ${o.added.length}`);
  if (o.removed.length) bits.push(`removed ${o.removed.length}`);
  if (!bits.length) bits.push("already in step");
  if (o.noCircleAccount.length) bits.push(`${o.noCircleAccount.length} with no Circle account`);
  if (o.stillMissing.length) bits.push(`⚠️ ${o.stillMissing.length} still missing after the write`);
  if (o.moderatorByHand.length)
    bits.push(`${o.moderatorByHand.length} to make moderator by hand`);
  return `${o.label}: ${bits.join(", ")} (as at ${o.asOf})`;
}

/**
 * The space group a space belongs to, or null for a standalone space.
 *
 * Read from `listSpaces` because Circle does not expose a space's group on the
 * space-members endpoints, and the community has few enough spaces that one
 * listing is cheaper than guessing.
 */
async function groupIdForSpace(
  client: NonNullable<ReturnType<typeof getCircleClient>>,
  spaceId: number
): Promise<number | null> {
  const spaces = await client.listSpaces();
  const found = spaces.find((sp) => sp.id === spaceId) as
    | ({ space_group_id?: number; space_group?: { id?: number } } | undefined);
  return found?.space_group_id ?? found?.space_group?.id ?? null;
}

export async function syncGovernanceSpaceNow(
  db: Db,
  rule: GovernanceSpaceRule,
  req: { asOf: string }
): Promise<SpaceSyncOutcome> {
  const { asOf } = req;
  if (!isCircleConfigured()) return empty(rule.label, asOf, "Circle is not configured here.");
  const client = getCircleClient();
  if (!client) return empty(rule.label, asOf, "Circle client could not be built.");

  const { holders, error } = await roleAccessHolders(db, rule.bodyKey, rule.roleKey, asOf);
  if (error) return empty(rule.label, asOf, error);

  const wanted = [...new Set([...holders.map((h) => h.email), ...rule.alwaysMembers])];

  const out: SpaceSyncOutcome = {
    label: rule.label,
    spaceGroupId: null,
    asOf,
    wanted,
    added: [],
    removed: [],
    noCircleAccount: [],
    stillMissing: [],
    moderatorByHand: [],
    problems: [],
  };

  // ⛔ Everyone who has EVER held this role, not just who holds it now. A
  // departed director's email is by definition not in `wanted`, so resolving
  // Circle ids for `wanted` alone left `everHeldIds` empty and the removal path
  // could never fire — caught by the test, not by reading this.
  const everHeld = await roleEverHeldBy(db, rule.bodyKey, rule.roleKey);

  // Resolve every email we might act on to a Circle member. ⛔ Somebody with no
  // Circle account cannot be added to anything, and inventing one for them is a
  // different decision than "put the board in the board space".
  const circleIdByEmail = new Map<string, number>();
  const toResolve = [...new Set([...wanted, ...everHeld.map((h) => h.email)])];
  for (const email of toResolve) {
    try {
      const member = await client.findMemberByEmail(email);
      if (member?.id) circleIdByEmail.set(email, member.id);
      else if (wanted.includes(email)) out.noCircleAccount.push(email);
    } catch (e) {
      out.problems.push(
        `could not look up ${email}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  const addable = wanted.filter((e) => circleIdByEmail.has(e));
  const wantedIds = new Set(addable.map((e) => circleIdByEmail.get(e)!));

  // Who held it and should no longer be in, by Circle id.
  const everHeldIds = new Map<number, string>();
  for (const h of everHeld) {
    const id = circleIdByEmail.get(h.email);
    if (id !== undefined && !wantedIds.has(id)) everHeldIds.set(id, h.email);
  }

  // --- The space itself ----------------------------------------------------
  let before: Set<number>;
  try {
    before = new Set(await client.listSpaceMemberIds(rule.spaceId));
  } catch (e) {
    return empty(
      rule.label,
      asOf,
      `could not read space ${rule.spaceId}: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  for (const email of addable) {
    const id = circleIdByEmail.get(email)!;
    if (before.has(id)) continue;
    try {
      await client.addMemberToSpace(rule.spaceId, email);
      out.added.push(email);
      // Not yet a moderator, and the API cannot make them one.
      out.moderatorByHand.push(email);
    } catch (e) {
      out.problems.push(`could not add ${email}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ⛔ Removals go through the SAME read-back discipline rather than the
  // `circle_sync_queue`. The queue was why removals "stay an obligation on a
  // person": jobs did not reliably drain, so nobody could tell whether a
  // departing director still had access. Calling Circle here and reading the
  // membership back afterwards is what makes a removal something we can claim.
  //
  // ⚠️ Only people the REGISTER says should be gone are removed, never everyone
  // who is not wanted: a space can legitimately hold staff and guests this rule
  // knows nothing about. `wanted` is the allow-list for ADDS; removals are
  // limited to contacts who hold, or held, this role.
  for (const [id, email] of everHeldIds) {
    if (!before.has(id)) continue;
    try {
      await client.removeMemberFromSpace(rule.spaceId, email);
      out.removed.push(email);
    } catch (e) {
      out.problems.push(`could not remove ${email}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // --- The space GROUP, which is what makes the spaces visible -------------
  //
  // ⚠️ Being in the space is not enough. `is_hidden_from_non_members` is true on
  // the Board of Directors group, so a director in both board spaces but not in
  // the group sees neither of them in their sidebar — they have access to a
  // thing they cannot find. Measured 2026-11-26: group and spaces hold the same
  // 17 people, but the space rows PREDATE the group rows by months, so the two
  // are maintained independently and nothing keeps them in step.
  try {
    const groupId = await groupIdForSpace(client, rule.spaceId);
    out.spaceGroupId = groupId;
    if (groupId) {
      const inGroup = new Set(await client.listSpaceGroupMemberIds(groupId));
      for (const email of addable) {
        const id = circleIdByEmail.get(email)!;
        if (inGroup.has(id)) continue;
        try {
          await client.addMemberToSpaceGroup(groupId, email);
        } catch (e) {
          out.problems.push(
            `in the space but could not be added to the group (so it stays hidden in their sidebar): ${email} — ${e instanceof Error ? e.message : String(e)}`
          );
        }
      }
      for (const [id, email] of everHeldIds) {
        if (!inGroup.has(id)) continue;
        try {
          await client.removeMemberFromSpaceGroup(groupId, email);
        } catch (e) {
          out.problems.push(
            `could not remove ${email} from the space group: ${e instanceof Error ? e.message : String(e)}`
          );
        }
      }
    }
  } catch (e) {
    out.problems.push(
      `could not reconcile the space group: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  // --- Read back, and only then report ------------------------------------
  try {
    const after = new Set(await client.listSpaceMemberIds(rule.spaceId));
    out.stillMissing = addable.filter((e) => !after.has(circleIdByEmail.get(e)!));
  } catch (e) {
    out.problems.push(
      `wrote the space but could not read it back: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  return out;
}
