/**
 * Put the people holding a governance role into the Google group that serves
 * it, and then read the membership back to prove it.
 *
 * ⛔ NOT on a schedule, on purpose. The board turns over once a year on a
 * button press. Polling a group every hour to learn nothing changed is 8,760
 * calls a year for one real change, and it moves the moment of truth away from
 * the press: the person who pressed the button walks away believing it worked,
 * and a failure lands in a `last_run` column nobody opens. Run it where the
 * decision is made, and report what happened to the person who made it.
 *
 * ⚠️ The add is never trusted. Google answers 200 and the membership is read
 * back and diffed before this reports success — the same discipline Circle's
 * read-back traps taught us.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { listGroupMembers, addGroupMember, workspaceConfigured } from "@/lib/google/directory";

type Db = ReturnType<typeof createAdminClient>;

/** An address CSC owns is a forwarder or an alias, never a person to manage. */
const ALIAS_DOMAIN = "@campusstores.ca";

export type GroupSyncOutcome = {
  groupEmail: string;
  label: string;
  /** Holders of the role right now, by institutional address. */
  wanted: string[];
  added: string[];
  alreadyThere: string[];
  failed: { email: string; reason: string }[];
  /** True only when the membership was read back after the adds. */
  verified: boolean;
  /** Wanted, and still not in the group after the adds. The failure that matters. */
  missing: string[];
  /** In the group holding no role. Reported for a person to action, never removed here. */
  stale: string[];
  error: string | null;
};

function emptyOutcome(groupEmail: string, label: string, error: string | null): GroupSyncOutcome {
  return {
    groupEmail,
    label,
    wanted: [],
    added: [],
    alreadyThere: [],
    failed: [],
    verified: false,
    missing: [],
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
  if (o.alreadyThere.length > 0) parts.push(`${o.alreadyThere.length} already there`);
  if (parts.length === 0) parts.push("nobody to add");
  let line = `${o.groupEmail}: ${parts.join(", ")}`;
  if (o.missing.length > 0) line += ` — but ${o.missing.join(", ")} did not land`;
  else if (o.verified) line += `, all ${o.wanted.length} confirmed in the group`;
  if (o.stale.length > 0) line += `. Still on the list holding no role: ${o.stale.join(", ")}`;
  return line;
}

/**
 * Sync one group now. Reports rather than throws: seating the directors has
 * already happened by the time this runs, and a group that did not take is
 * something to tell somebody about, not a reason to unwind the seating.
 */
export async function syncGovernanceGroupNow(
  db: Db,
  rule: { id: string; label: string; bodyKey: string; roleKey: string },
  groupEmail: string
): Promise<GroupSyncOutcome> {
  if (!workspaceConfigured())
    return emptyOutcome(groupEmail, rule.label, "Google Workspace is not configured here.");

  const { data: body } = await db
    .from("governance_bodies")
    .select("id")
    .eq("key", rule.bodyKey)
    .maybeSingle();
  if (!body) return emptyOutcome(groupEmail, rule.label, `no governance body "${rule.bodyKey}"`);

  const today = new Date().toISOString().slice(0, 10);
  const { data: holders } = await db
    .from("governance_role_assignments")
    .select("person_contact_id, contacts(email)")
    .eq("body_id", body.id)
    .eq("role_key", rule.roleKey)
    .lte("term_start", today)
    .or(`term_end.is.null,term_end.gt.${today}`);

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
      `could not read the group: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  const present = new Set(before.map((m) => m.email));
  const alreadyThere = wanted.filter((e) => present.has(e));
  const toAdd = wanted.filter((e) => !present.has(e));

  const added: string[] = [];
  const failed: { email: string; reason: string }[] = [];
  for (const email of toAdd) {
    try {
      await addGroupMember(groupEmail, email);
      added.push(email);
    } catch (e) {
      failed.push({ email, reason: e instanceof Error ? e.message : String(e) });
    }
  }

  // The verification. Everything above is what we believe happened; this is
  // what Google says is true.
  let after: { email: string; role: string }[];
  try {
    after = await listGroupMembers(groupEmail);
  } catch (e) {
    const o = emptyOutcome(groupEmail, rule.label, null);
    return {
      ...o,
      wanted,
      added,
      alreadyThere,
      failed,
      error: `added ${added.length}, but could not read the group back to confirm: ${
        e instanceof Error ? e.message : String(e)
      }`,
    };
  }

  const nowPresent = new Set(after.map((m) => m.email));
  const missing = wanted.filter((e) => !nowPresent.has(e));
  // ⛔ Counted, never acted on. An alias is not a person, and a MANAGER or
  // OWNER was made one by hand — taking either off is somebody's decision.
  const stale = after
    .filter((m) => !wanted.includes(m.email) && !m.email.endsWith(ALIAS_DOMAIN) && m.role === "MEMBER")
    .map((m) => m.email);

  const outcome: GroupSyncOutcome = {
    groupEmail,
    label: rule.label,
    wanted,
    added,
    alreadyThere,
    failed,
    verified: true,
    missing,
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
        queuedRemoves: stale.length,
        ...(missing.length > 0 || failed.length > 0
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
): Promise<{ id: string; label: string; bodyKey: string; roleKey: string; groupEmail: string }[]> {
  const { data } = await db
    .from("circle_space_rules")
    .select("id, label, body_key, role_key, google_group_email")
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
    }));
}
