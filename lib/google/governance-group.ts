/**
 * Put the people holding a governance role into the Google group that serves
 * it, take off the people who have stopped holding it, and then read the
 * membership back to prove both.
 *
 * ⛔ NOT on a schedule, on purpose. The board turns over once a year on a
 * button press. Polling a group every hour to learn nothing changed is 8,760
 * calls a year for one real change, and it moves the moment of truth away from
 * the press: the person who pressed the button walks away believing it worked,
 * and a failure lands in a `last_run` column nobody opens. Run it where the
 * decision is made, and report what happened to the person who made it.
 *
 * ⚠️ Nothing is trusted. Google answers 200 on an add that does not take, and
 * on a delete the same way. The membership is read back and diffed before this
 * reports success — the same discipline Circle's read-back traps taught us.
 *
 * ⛔ Every holder decision is made as of `asOf`, the date entered at the press,
 * never the wall clock. The two sides of a changeover happen months apart and
 * the register already carries exclusive term dates: reading "who holds this
 * role" against today would answer a different question than the one on screen.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import {
  listGroupMembers,
  addGroupMember,
  removeGroupMember,
  workspaceConfigured,
} from "@/lib/google/directory";

type Db = ReturnType<typeof createAdminClient>;

/** An address CSC owns is a forwarder or an alias, never a person to manage. */
const ALIAS_DOMAIN = "@campusstores.ca";

export type GroupSyncOutcome = {
  groupEmail: string;
  label: string;
  /** The effective date every holder decision below was made against. */
  asOf: string;
  /** Holders of the role as of `asOf`, by institutional address. */
  wanted: string[];
  added: string[];
  alreadyThere: string[];
  removed: string[];
  failed: { email: string; reason: string; action: "add" | "remove" }[];
  /** True only when the membership was read back after the writes. */
  verified: boolean;
  /** Wanted, and still not in the group afterwards. The add failure that matters. */
  missing: string[];
  /** Named for removal, and still in the group afterwards. The remove failure that matters. */
  stillThere: string[];
  /**
   * Named for removal and deliberately not removed, with the reason. A refusal
   * somebody should see rather than a silent skip.
   */
  leftAlone: { email: string; reason: string }[];
  /** In the group holding no role and not named either way. Reported, never acted on. */
  stale: string[];
  error: string | null;
};

export type GroupSyncRequest = {
  /** The effective date from the press. Required: see the file header. */
  asOf: string;
  /**
   * The exact addresses to take off, named by the caller.
   *
   * ⛔ Never inferred from "holds no role". That set also contains addresses a
   * person put on the list for their own reasons — a management company, a
   * shared inbox — and sweeping it would be a decision nobody made. The caller
   * passes the people it showed on screen before the press.
   */
  remove?: string[];
  /**
   * Addresses that hold no role as of `asOf` but belong on the list anyway, so
   * they are not reported as drift. CSC's outgoing directors keep the mailing
   * list until the conference after the meeting: at the seating press their
   * register terms have already ended, and without this they would be named as
   * strays on the very screen that is supposed to be trustworthy.
   *
   * Also carries the rule's own declared always-on addresses — a shared inbox,
   * a management company, a second address for somebody who misses the first.
   * Those are permanent rather than per-press, which is why they are declared
   * on the rule and merged in by the caller instead of being worked out here.
   */
  retain?: string[];
};

function emptyOutcome(
  groupEmail: string,
  label: string,
  asOf: string,
  error: string | null
): GroupSyncOutcome {
  return {
    groupEmail,
    label,
    asOf,
    wanted: [],
    added: [],
    alreadyThere: [],
    removed: [],
    failed: [],
    verified: false,
    missing: [],
    stillThere: [],
    leftAlone: [],
    stale: [],
    error,
  };
}

/**
 * One line a person can read without opening anything else. This is what the
 * button reports back, so it has to say whether it worked in its first clause.
 */
export function describeOutcome(o: GroupSyncOutcome): string {
  if (o.error) return `${o.groupEmail}: ${o.error}`;

  const parts: string[] = [];
  if (o.added.length > 0) parts.push(`${o.added.length} added`);
  if (o.removed.length > 0) parts.push(`${o.removed.length} taken off`);
  if (o.alreadyThere.length > 0) parts.push(`${o.alreadyThere.length} already there`);
  if (parts.length === 0) parts.push("nothing to change");

  let line = `${o.groupEmail}: ${parts.join(", ")}`;

  const broke: string[] = [];
  if (o.missing.length > 0) broke.push(`${o.missing.join(", ")} did not land`);
  if (o.stillThere.length > 0) broke.push(`${o.stillThere.join(", ")} is still on the list`);
  if (broke.length > 0) line += ` — but ${broke.join("; and ")}`;
  else if (o.verified) line += `, confirmed by reading the group back`;

  if (o.leftAlone.length > 0)
    line += `. Left alone: ${o.leftAlone.map((l) => `${l.email} (${l.reason})`).join(", ")}`;
  if (o.stale.length > 0) line += `. On the list holding no role: ${o.stale.join(", ")}`;
  return line;
}

/**
 * Sync one group now. Reports rather than throws: the seating or the standing
 * down has already happened by the time this runs, and a group that did not
 * take is something to tell somebody about, not a reason to unwind it.
 */
export async function syncGovernanceGroupNow(
  db: Db,
  rule: { id: string; label: string; bodyKey: string; roleKey: string },
  groupEmail: string,
  req: GroupSyncRequest
): Promise<GroupSyncOutcome> {
  const { asOf } = req;
  if (!workspaceConfigured())
    return emptyOutcome(groupEmail, rule.label, asOf, "Google Workspace is not configured here.");

  const { data: body } = await db
    .from("governance_bodies")
    .select("id")
    .eq("key", rule.bodyKey)
    .maybeSingle();
  if (!body)
    return emptyOutcome(groupEmail, rule.label, asOf, `no governance body "${rule.bodyKey}"`);

  // ⚠️ term_end is EXCLUSIVE, so `gt` is right: a term ending on asOf is over.
  const { data: holders } = await db
    .from("governance_role_assignments")
    .select("person_contact_id, contacts(email)")
    .eq("body_id", body.id)
    .eq("role_key", rule.roleKey)
    .lte("term_start", asOf)
    .or(`term_end.is.null,term_end.gt.${asOf}`);

  const wanted = [
    ...new Set(
      (holders ?? [])
        .map((h) => (h.contacts as { email?: string } | null)?.email?.toLowerCase())
        .filter((e): e is string => Boolean(e))
    ),
  ];

  let before: { email: string; role: string }[];
  try {
    before = await listGroupMembers(groupEmail);
  } catch (e) {
    return emptyOutcome(
      groupEmail,
      rule.label,
      asOf,
      `could not read the group: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  const onList = new Map(before.map((m) => [m.email, m]));
  const alreadyThere = wanted.filter((e) => onList.has(e));
  const toAdd = wanted.filter((e) => !onList.has(e));

  const added: string[] = [];
  const failed: { email: string; reason: string; action: "add" | "remove" }[] = [];
  for (const email of toAdd) {
    try {
      await addGroupMember(groupEmail, email);
      added.push(email);
    } catch (e) {
      failed.push({ email, reason: e instanceof Error ? e.message : String(e), action: "add" });
    }
  }

  // Hoisted above the removal loop, not just used for the stale report below:
  // a retained address must survive being named for removal as well as being
  // counted as drift. Those are the same fact and must not disagree.
  const retain = new Set((req.retain ?? []).map((e) => e.toLowerCase()));
  const askedToGo = [...new Set((req.remove ?? []).map((e) => e.toLowerCase()))];
  const removed: string[] = [];
  const leftAlone: { email: string; reason: string }[] = [];
  for (const email of askedToGo) {
    const m = onList.get(email);
    // Already off. The end state asked for, so nothing to report.
    if (!m) continue;
    // ⛔ The register outranks the caller. A name can reach the removal list
    // and still hold the role — re-elected under a new term, or holding it a
    // second way — and taking that person off would be the one unrecoverable
    // mistake available here.
    if (wanted.includes(email)) {
      leftAlone.push({ email, reason: "still holds the role on this body" });
      continue;
    }
    // ⛔ A declaration outranks the caller too. Somebody said this address
    // belongs on the list whatever the roster says, and a press months later
    // does not revisit that. Reached when a declared address also holds the
    // role and then appears under "Leaving".
    if (retain.has(email)) {
      leftAlone.push({ email, reason: "declared as belonging on this list whatever the roster says" });
      continue;
    }
    if (email.endsWith(ALIAS_DOMAIN)) {
      leftAlone.push({ email, reason: "an address CSC owns, so a forwarder rather than a person" });
      continue;
    }
    // ⛔ A MANAGER or OWNER was made one by a person, and nothing about a seat
    // ending implies that should go. Same rule the add side follows in reverse.
    if (m.role !== "MEMBER") {
      leftAlone.push({ email, reason: `a group ${m.role.toLowerCase()}, set by hand` });
      continue;
    }
    try {
      await removeGroupMember(groupEmail, email);
      removed.push(email);
    } catch (e) {
      failed.push({ email, reason: e instanceof Error ? e.message : String(e), action: "remove" });
    }
  }

  // The verification. Everything above is what we believe happened; this is
  // what Google says is true.
  let after: { email: string; role: string }[];
  try {
    after = await listGroupMembers(groupEmail);
  } catch (e) {
    const o = emptyOutcome(groupEmail, rule.label, asOf, null);
    return {
      ...o,
      wanted,
      added,
      alreadyThere,
      removed,
      failed,
      leftAlone,
      error: `wrote ${added.length} add${added.length === 1 ? "" : "s"} and ${
        removed.length
      } removal${removed.length === 1 ? "" : "s"}, but could not read the group back to confirm: ${
        e instanceof Error ? e.message : String(e)
      }`,
    };
  }

  const nowPresent = new Set(after.map((m) => m.email));
  const missing = wanted.filter((e) => !nowPresent.has(e));
  // ⚠️ Only the ones actually attempted. Somebody deliberately left alone is
  // not a failed removal, and counting them here would make every run look broken.
  const spared = new Set(leftAlone.map((l) => l.email));
  const stillThere = askedToGo.filter((e) => nowPresent.has(e) && !spared.has(e));

  // ⛔ Counted, never acted on. An alias is not a person, a MANAGER or OWNER
  // was made one by hand, and a retained address is on the list on purpose —
  // either for this press or by standing declaration on the rule.
  const stale = after
    .filter(
      (m) =>
        !wanted.includes(m.email) &&
        !retain.has(m.email) &&
        !m.email.endsWith(ALIAS_DOMAIN) &&
        m.role === "MEMBER"
    )
    .map((m) => m.email);

  const outcome: GroupSyncOutcome = {
    groupEmail,
    label: rule.label,
    asOf,
    wanted,
    added,
    alreadyThere,
    removed,
    failed,
    verified: true,
    missing,
    stillThere,
    leftAlone,
    stale,
    error: null,
  };

  // The rules screen keeps showing the last real run — which is now this one,
  // not an hourly tick that found nothing to do.
  await db
    .from("circle_space_rules")
    .update({
      last_run: {
        holders: wanted.length,
        inSpace: nowPresent.size,
        queuedAdds: added.length,
        queuedRemoves: removed.length,
        ...(missing.length > 0 || stillThere.length > 0 || failed.length > 0
          ? { error: describeOutcome(outcome) }
          : {}),
      },
      last_run_at: new Date().toISOString(),
    })
    .eq("id", rule.id);

  return outcome;
}

/**
 * Every Google group that follows a role on this body. Plural because a body
 * can grow a second group (officers, say) without anybody wiring a trigger.
 */
export async function groupRulesForBody(
  db: Db,
  bodyKey: string
): Promise<
  {
    id: string;
    label: string;
    bodyKey: string;
    roleKey: string;
    groupEmail: string;
    /** Declared on the rule: on this list whatever the roster says. */
    alwaysMembers: string[];
  }[]
> {
  const { data } = await db
    .from("circle_space_rules")
    .select("id, label, body_key, role_key, google_group_email, always_members")
    .eq("destination", "google_group")
    .eq("kind", "governance_role")
    .eq("body_key", bodyKey);

  return (data ?? [])
    .filter((r) => r.google_group_email && r.body_key && r.role_key)
    .map((r) => ({
      id: r.id as string,
      label: r.label as string,
      bodyKey: r.body_key as string,
      roleKey: r.role_key as string,
      groupEmail: (r.google_group_email as string).toLowerCase(),
      alwaysMembers: ((r.always_members as string[] | null) ?? []).map((e) => e.toLowerCase()),
    }));
}
