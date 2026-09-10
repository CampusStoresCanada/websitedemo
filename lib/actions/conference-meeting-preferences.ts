"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { canManageOrganization, isGlobalAdmin, requireAuthenticated } from "@/lib/auth/guards";
import { loadSeatHoldings } from "@/lib/conference/seats";
import { CONTAINMENT_ROLE } from "@/lib/conference/inclusion";
import { getProgramsConfig } from "@/lib/policy/engine";
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
  /** Links to the profile so "who is that?" is one click and a back button. */
  slug: string | null;
  logoUrl: string | null;
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
  /** Whether the row should say anything about meeting capability at all. */
  showsMeetingCapability: boolean;
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
export async function listOrgsPresent(
  conferenceId: string,
  /**
   * ⛔ Whose list this is. Meetings are buyer↔seller, so a store picks VENDORS
   * and a vendor picks STORES — never its own side.
   *
   * Caught by clicking it: a partner was being shown other partners and, worse,
   * member colleges labelled "No meetings", which is meaningless. A store does
   * not need a suite to attend a meeting; it sits in the vendor's.
   */
  viewerOrgId: string
): Promise<PresentOrg[]> {
  const db = createAdminClient();

  const [{ data: viewer }, programs] = await Promise.all([
    db.from("organizations").select("type").eq("id", viewerOrgId).maybeSingle(),
    getProgramsConfig(),
  ]);

  /**
   * ⛔ WHICH SIDE SOMEONE IS ON IS CONFIGURED, NOT HARDCODED.
   *
   * `MembershipProgramDef` maps a literal `organizations.type` value to a
   * permission level, and CSC edits those programs — so `type === "Member"` in
   * source is a guess that survives only until somebody renames a program or
   * adds a second one on the same side. I wrote that literal here after being
   * corrected on exactly it earlier the same day.
   *
   * Reading the programs also handles the case a hardcode cannot: two org types
   * that both resolve to `member`.
   */
  const levelOf = (orgType: string | null | undefined) =>
    programs.find((program) => program.orgTypeValue === orgType)?.permissionLevel ?? null;

  const viewerLevel = levelOf(viewer?.type as string | null);
  // Meetings are buyer↔seller, so the list is always the OTHER side. Anyone on
  // neither side (CSC staff) gets no list rather than a guess.
  const wantedLevel =
    viewerLevel === "member" ? "partner" : viewerLevel === "partner" ? "member" : null;
  if (!wantedLevel) return [];

  const wantedTypes = programs
    .filter((program) => program.permissionLevel === wantedLevel)
    .map((program) => program.orgTypeValue);
  if (wantedTypes.length === 0) return [];

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
    .select("id, name, slug, logo_url, is_test")
    .in("id", orgIds)
    .in("type", wantedTypes)
    .is("archived_at", null);

  return ((orgs ?? []) as Array<Record<string, unknown>>)
    // A test org in a real picker would let someone choose a company that does
    // not exist. Same filter the rest of the site applies to them.
    .filter((o) => o.is_test !== true)
    .map((o) => ({
      id: o.id as string,
      name: (o.name as string) ?? "",
      slug: (o.slug as string | null) ?? null,
      logoUrl: (o.logo_url as string | null) ?? null,
      /**
       * Only meaningful for vendors — they are the ones who need a suite. A
       * store attends in the vendor's room, so the label is suppressed when a
       * vendor is looking at stores.
       */
      /**
       * Only the supply side needs a room of its own — a store attends in the
       * vendor's suite — so capability is a fact about partners and is neither
       * shown nor computed when a vendor is looking at stores.
       */
      takesMeetings: wantedLevel === "partner" ? orgsWithSuites.has(o.id as string) : true,
      showsMeetingCapability: wantedLevel === "partner",
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
    listOrgsPresent(conferenceId, orgId),
  ]);

  const db = createAdminClient() as unknown as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    from: (table: string) => { select: (columns: string) => any };
  };
  /**
   * ⛔ ORG-GRAIN ROWS ONLY — `declaring_contact_id is null`. The same table now
   * holds delegates' personal refusals, and without this filter a store admin
   * would see one buyer's private "rather not" as the company's position and,
   * worse, be able to untick it.
   */
  const { data: refusals } = await db
    .from("org_meeting_refusals")
    .select("refused_org_id")
    .eq("declaring_org_id", orgId)
    .is("declaring_contact_id", null)
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
      /**
       * ⛔ BROWSE, and it must stay honest. Both pickers are one alphabetical
       * list of everyone present — nothing is ranked, suggested or searched, so
       * every pick made here is the person's own. The moment a picker starts
       * from something we ordered, this has to become "suggested" or the match
       * engine will be learning from its own output without anyone noticing.
       */
      chosenFrom: "browse",
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
      // ⛔ Never reach a delegate's own row. An org admin withdrawing the
      // company's refusal must not also withdraw one of their staff's.
      .is("declaring_contact_id", null)
      .is("retired_at", null);
    if (error) return { success: false, error: error.message };
    return { success: true };
  }

  const { error } = await db.from("org_meeting_refusals").insert({
    declaring_org_id: params.declaringOrgId,
    refused_org_id: params.refusedOrgId,
    // Null = the ORGANIZATION is the subject. Stated rather than defaulted, so
    // the grain is visible at the write site next to the person version below.
    declaring_contact_id: null,
    declared_by_contact_id: contactId,
    reason: params.reason ?? null,
    first_declared_at: nowIso,
    reaffirmed_at: nowIso,
  });
  if (error) return { success: false, error: error.message };
  return { success: true };
}


/**
 * A DELEGATE'S OWN LIST — no org-admin rights required.
 *
 * ⛔ The grain follows the event, not a permission. A trade show has people who
 * attend and companies that exhibit: a delegate picks for themselves because
 * three buyers from one store want three different sets of meetings, while an
 * exhibitor's suite meets whoever walks in, so the company has one list.
 *
 * So the check here is "are you this person" — you hold a named seat at this
 * conference — rather than "do you speak for this company". An attendee who is
 * not an admin still gets to say who they want to meet, which was the whole
 * point: if I am going to the conference, I should be given the choices.
 */
async function callerAsDelegate(conferenceId: string): Promise<
  { ok: true; personId: string; contactId: string | null; orgId: string } | { ok: false; error: string }
> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { ok: false, error: auth.error };

  const db = createAdminClient();
  const { data } = await db
    .from("conference_people")
    .select("id, organization_id, contact_id, canonical_person_id")
    .eq("conference_id", conferenceId)
    .eq("user_id", auth.ctx.userId)
    .neq("assignment_status", "canceled")
    .maybeSingle();

  if (!data) return { ok: false, error: "You are not registered for this conference." };
  return {
    ok: true,
    personId: data.id as string,
    // contact_id first — canonical_person_id has no FK. Same precedence as
    // loadSeatHoldings and the badge pipeline.
    contactId:
      ((data.contact_id as string | null) || (data.canonical_person_id as string | null)) ?? null,
    orgId: data.organization_id as string,
  };
}

/**
 * Both of a delegate's lists in one read, because both render on one page from
 * the same `present` roster — the same shape `getMeetingPreferences` returns for
 * an org. Fetching them separately would run `listOrgsPresent` twice per load.
 */
export async function getMyMeetingPreferences(
  conferenceId: string
): Promise<
  ActionResult<{
    chosenOrgIds: string[];
    refusedOrgIds: string[];
    present: PresentOrg[];
    limit: number;
  }>
> {
  const me = await callerAsDelegate(conferenceId);
  if (!me.ok) return { success: false, error: me.error };
  if (!me.contactId) {
    return { success: false, error: "We could not match you to a contact record." };
  }

  const db = createAdminClient() as unknown as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    from: (table: string) => { select: (columns: string) => any };
  };

  const [choices, present, refusals] = await Promise.all([
    loadTopChoices(conferenceId),
    listOrgsPresent(conferenceId, me.orgId),
    // ⛔ Keyed on the CONTACT, not the org — my list, not my employer's and not
    // my colleague's.
    db
      .from("org_meeting_refusals")
      .select("refused_org_id")
      .eq("declaring_contact_id", me.contactId)
      .is("retired_at", null),
  ]);

  return {
    success: true,
    data: {
      chosenOrgIds: indexTopChoices(choices)
        .chosenByContact(me.contactId)
        .map((c) => c.chosenOrgId),
      refusedOrgIds: (
        (refusals.data ?? []) as Array<{ refused_org_id: string }>
      ).map((r) => r.refused_org_id),
      present,
      limit: TOP_CHOICE_LIMIT,
    },
  };
}

/**
 * A delegate declaring or withdrawing their OWN refusal.
 *
 * ⛔ Not org-admin gated, and deliberately not the same row an admin edits.
 * "I would rather not sit with them" is a personal statement about where this
 * person is seated: it binds their seat only, does not mirror onto the vendor,
 * and is invisible to their org's admins — who have no business overruling it
 * and no way to reach it (`setRefusal` filters to org-grain rows).
 *
 * ⛔ Withdrawing RETIRES rather than deletes, same as the org version. A
 * refusal that was in force is a fact about the past even once it is lifted.
 */
export async function setMyRefusal(params: {
  conferenceId: string;
  refusedOrgId: string;
  refused: boolean;
}): Promise<ActionResult> {
  const me = await callerAsDelegate(params.conferenceId);
  if (!me.ok) return { success: false, error: me.error };
  if (!me.contactId) {
    return { success: false, error: "We could not match you to a contact record." };
  }
  if (params.refusedOrgId === me.orgId) {
    return { success: false, error: "You cannot refuse your own organization." };
  }

  const nowIso = new Date().toISOString();
  const db = createAdminClient() as unknown as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    from: (table: string) => any;
  };

  if (!params.refused) {
    const { error } = await db
      .from("org_meeting_refusals")
      .update({ retired_at: nowIso, retired_by_contact_id: me.contactId, updated_at: nowIso })
      .eq("declaring_contact_id", me.contactId)
      .eq("refused_org_id", params.refusedOrgId)
      .is("retired_at", null);
    if (error) return { success: false, error: error.message };
    return { success: true };
  }

  const { error } = await db.from("org_meeting_refusals").insert({
    // The org still travels with the row: it is where this person sat when they
    // said it, which is what a later review needs to make sense of it.
    declaring_org_id: me.orgId,
    declaring_contact_id: me.contactId,
    refused_org_id: params.refusedOrgId,
    declared_by_contact_id: me.contactId,
    reason: null,
    first_declared_at: nowIso,
    reaffirmed_at: nowIso,
  });
  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function saveMyTopChoices(
  conferenceId: string,
  chosenOrgIds: string[]
): Promise<ActionResult> {
  const me = await callerAsDelegate(conferenceId);
  if (!me.ok) return { success: false, error: me.error };
  if (!me.contactId) {
    return { success: false, error: "We could not match you to a contact record." };
  }

  try {
    await replaceTopChoices({
      conferenceId,
      declaringOrgId: me.orgId,
      // ⛔ The subject is ME. Clearing is scoped to this contact, so saving my
      // five can never erase a colleague's.
      declaringContactId: me.contactId,
      declaredByContactId: me.contactId,
      // Same alphabetical list as the org picker — nothing here is ranked by us.
      chosenFrom: "browse",
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
