"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { canManageOrganization, isGlobalAdmin, requireAuthenticated } from "@/lib/auth/guards";
import { loadSeatHoldings } from "@/lib/conference/seats";
import { CONTAINMENT_ROLE } from "@/lib/conference/inclusion";
import {
  loadTopChoices,
  replaceTopChoices,
  indexTopChoices,
  TOP_CHOICE_LIMIT,
} from "@/lib/conference/top-choices";

/**
 * Where a store or a vendor says who they want to meet, and who they do not.
 *
 * Both are expressions by an ORG, entered by a person who is accountable for
 * them. Neither is a promise:
 *
 *   TOP CHOICES — "we would like to meet these five." An expression of interest
 *   the scheduler attempts to accommodate. It reserves nothing, because a member
 *   who was promised a meeting and did not get one is worse off than one who was
 *   never promised.
 *
 *   REFUSALS — "we do not want to meet these people." Heavily weighted against,
 *   and deliberately NOT sold as an absolute lock. Being put in a room with
 *   someone you have no intention of buying from is a miserable fifteen minutes
 *   for both sides, which is the whole reason to collect it.
 *
 * ⛔ The weighting is not decided here. This layer stores what people said; how
 * much it moves a schedule is the match engine's business and the scheduler's.
 * A collection surface that also decided the weight would be two things at once
 * and would drift from whatever the engine does.
 */

type ActionResult<T = undefined> =
  | { success: true; data?: T }
  | { success: false; error: string };

/** Who may speak for an org: its own admins, or CSC. */
async function requireOrgVoice(orgId: string): Promise<ActionResult> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };
  if (canManageOrganization(auth.ctx, orgId) || isGlobalAdmin(auth.ctx.globalRole)) {
    return { success: true };
  }
  return { success: false, error: "Only this organization's admins can change that." };
}

async function contactIdFor(orgId: string): Promise<string | null> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return null;
  const db = createAdminClient();
  const { data } = await db
    .from("contacts")
    .select("id")
    .eq("organization_id", orgId)
    .eq("profile_id", auth.ctx.userId)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

export type PresentOrg = {
  id: string;
  name: string;
  type: string | null;
  /**
   * Whether this org has a suite, i.e. can actually hold scheduled meetings.
   *
   * ⛔ SHOWN, NEVER ENFORCED. Only the higher-tier booths include a suite, so
   * picking a standard exhibitor cannot produce a meeting this year — but the
   * pick is still recorded, because it is one of the most useful things we can
   * learn. The ED: a standard exhibitor finding that 47 people would rather
   * have had twelve minutes with them than catch them on a booked-solid floor
   * is genuinely useful, to us and to them. Filtering those picks out would
   * throw away the demand signal that justifies the upgrade.
   */
  takesMeetings: boolean;
};

/**
 * Who is actually going to be there, which is the list you pick five from.
 *
 * ⛔ Only orgs with something at THIS conference. Offering the full 160-org
 * directory would let someone pick five companies who are not coming, and the
 * whole signal is "of the people who will be in the building".
 *
 * Seat holders come through loadSeatHoldings (the gated reader); booth holders
 * come from entity_balances, which is where a booth purchase is recorded.
 */
export async function listOrgsPresent(conferenceId: string): Promise<PresentOrg[]> {
  const db = createAdminClient();

  const { seats } = await loadSeatHoldings(db, { conferenceId });
  const { data: balances } = await db
    .from("entity_balances")
    .select("organization_id, entity_id")
    .eq("conference_id", conferenceId);

  const orgIds = [
    ...new Set([
      ...seats.map((s) => s.organizationId),
      ...((balances ?? []).map((b) => b.organization_id as string | null) ?? []),
    ]),
  ].filter((id): id is string => Boolean(id));

  if (orgIds.length === 0) return [];

  /**
   * Who can hold meetings = who holds a booth that `includes` a suite. Derived
   * from the graph rather than from a price or a product name, the same way the
   * scheduler derives it (see lib/conference/inclusion.ts).
   */
  const { data: suiteRefs } = await db
    .from("conference_entity_refs")
    .select("from_entity_id, to_entity_id, role")
    .eq("conference_id", conferenceId)
    .eq("role", CONTAINMENT_ROLE);
  const { data: suiteEntities } = await db
    .from("conference_entities")
    .select("id")
    .eq("conference_id", conferenceId)
    .eq("kind", "suite");

  const suiteIds = new Set((suiteEntities ?? []).map((e) => e.id as string));
  const boothsWithSuites = new Set(
    (suiteRefs ?? [])
      .filter((r) => suiteIds.has(r.to_entity_id as string))
      .map((r) => r.from_entity_id as string)
  );
  const orgsWithSuites = new Set(
    (balances ?? [])
      .filter((b) => boothsWithSuites.has(b.entity_id as string))
      .map((b) => b.organization_id as string)
  );

  const { data: orgs } = await db
    .from("organizations")
    .select("id, name, type, is_test")
    .in("id", orgIds)
    .is("archived_at", null);

  return ((orgs ?? []) as Array<Record<string, unknown>>)
    // A test org in a real picker would let someone choose a company that does
    // not exist. Same filter the rest of the site applies to them.
    .filter((o) => o.is_test !== true)
    .map((o) => ({
      id: o.id as string,
      name: (o.name as string) ?? "",
      type: (o.type as string | null) ?? null,
      takesMeetings: orgsWithSuites.has(o.id as string),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getMeetingPreferences(
  conferenceId: string,
  orgId: string
): Promise<
  ActionResult<{
    topChoiceOrgIds: string[];
    refusedOrgIds: string[];
    present: PresentOrg[];
    limit: number;
  }>
> {
  const allowed = await requireOrgVoice(orgId);
  if (!allowed.success) return allowed;

  const [choices, present] = await Promise.all([
    loadTopChoices(conferenceId),
    listOrgsPresent(conferenceId),
  ]);

  const db = createAdminClient() as unknown as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    from: (table: string) => { select: (columns: string) => any };
  };
  const { data: refusals } = await db
    .from("org_meeting_refusals")
    .select("refused_org_id")
    .eq("declaring_org_id", orgId)
    .is("retired_at", null);

  return {
    success: true,
    data: {
      topChoiceOrgIds: indexTopChoices(choices)
        .chosenBy(orgId)
        .map((c) => c.chosenOrgId),
      refusedOrgIds: ((refusals ?? []) as Array<{ refused_org_id: string }>).map(
        (r) => r.refused_org_id
      ),
      present,
      limit: TOP_CHOICE_LIMIT,
    },
  };
}

export async function saveTopChoices(
  conferenceId: string,
  orgId: string,
  chosenOrgIds: string[]
): Promise<ActionResult> {
  const allowed = await requireOrgVoice(orgId);
  if (!allowed.success) return allowed;

  try {
    await replaceTopChoices({
      conferenceId,
      declaringOrgId: orgId,
      declaredByContactId: await contactIdFor(orgId),
      chosenOrgIds,
    });
    return { success: true };
  } catch (cause) {
    return {
      success: false,
      error: cause instanceof Error ? cause.message : "Could not save your choices.",
    };
  }
}

/**
 * Declare or withdraw a refusal.
 *
 * ⛔ Withdrawing RETIRES rather than deletes. A refusal is a human relationship
 * fact and the record that it was once in force matters — an admin looking at a
 * schedule needs to be able to see that a pair was refused until last March,
 * not find an absence.
 */
export async function setRefusal(params: {
  declaringOrgId: string;
  refusedOrgId: string;
  refused: boolean;
  reason?: string | null;
}): Promise<ActionResult> {
  const allowed = await requireOrgVoice(params.declaringOrgId);
  if (!allowed.success) return allowed;

  if (params.declaringOrgId === params.refusedOrgId) {
    return { success: false, error: "An organization cannot refuse itself." };
  }

  const contactId = await contactIdFor(params.declaringOrgId);
  const nowIso = new Date().toISOString();
  const db = createAdminClient() as unknown as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    from: (table: string) => any;
  };

  if (!params.refused) {
    const { error } = await db
      .from("org_meeting_refusals")
      .update({ retired_at: nowIso, retired_by_contact_id: contactId, updated_at: nowIso })
      .eq("declaring_org_id", params.declaringOrgId)
      .eq("refused_org_id", params.refusedOrgId)
      .is("retired_at", null);
    if (error) return { success: false, error: error.message };
    return { success: true };
  }

  const { error } = await db.from("org_meeting_refusals").insert({
    declaring_org_id: params.declaringOrgId,
    refused_org_id: params.refusedOrgId,
    declared_by_contact_id: contactId,
    reason: params.reason ?? null,
    first_declared_at: nowIso,
    reaffirmed_at: nowIso,
  });
  if (error) return { success: false, error: error.message };
  return { success: true };
}
