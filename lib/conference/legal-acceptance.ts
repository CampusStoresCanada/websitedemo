/**
 * DB-touching legal-acceptance resolution. Split out from
 * lib/actions/conference-legal.ts (a "use server" file whose two
 * acceptance-check wrappers, checkLegalAcceptance / getPersonAssigneeLegalGate,
 * both require an authenticated session) so the underlying logic — no auth
 * guard, just a db client + ids — is safely callable from contexts with no
 * session at all, like the checklist reminder engine's cron job.
 *
 * legal-policies.ts stays pure/DB-free on purpose (unit-testable); this file
 * is the DB-loading layer that feeds it, same role conference-legal.ts's now-
 * removed local copies played, just relocated so it's importable from
 * anywhere without dragging in "use server" or a session requirement.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { loadSeatHoldings } from "@/lib/conference/seats";
import { getProgramsConfig, resolveConferenceTier } from "@/lib/policy/engine";
import {
  isLegallyExempt,
  requiredPolicyEntityIds,
  type PolicyTargeting,
  type Registrant,
} from "./legal-policies";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Load the policy-targeting graph for a conference: for each `policy` entity,
 * whether it applies to everyone, which audience tiers it's `who`-targeted at,
 * and which entities `requires` it. Pure resolution lives in legal-policies.ts.
 */
export async function loadPolicyTargeting(
  db: AdminClient,
  conferenceId: string
): Promise<PolicyTargeting[]> {
  const { data: policies } = await db
    .from("conference_entities")
    .select("id, attributes")
    .eq("conference_id", conferenceId)
    .eq("kind", "policy");
  const policyIds = (policies ?? []).map((p) => p.id);
  if (policyIds.length === 0) return [];

  // who edges: policy --who--> audience (need the audience's source_role tier)
  const { data: whoRefs } = await db
    .from("conference_entity_refs")
    .select("from_entity_id, to_entity_id")
    .eq("conference_id", conferenceId)
    .eq("role", "who")
    .in("from_entity_id", policyIds);
  const audienceIds = [...new Set((whoRefs ?? []).map((r) => r.to_entity_id))];
  const audienceRole = new Map<string, string>();
  if (audienceIds.length > 0) {
    const { data: auds } = await db.from("conference_entities").select("id, attributes").in("id", audienceIds);
    for (const a of auds ?? []) {
      const role = (a.attributes as Record<string, unknown> | null)?.["source_role"];
      if (typeof role === "string") audienceRole.set(a.id, role);
    }
  }

  // requires edges: entity --requires--> policy
  const { data: reqRefs } = await db
    .from("conference_entity_refs")
    .select("from_entity_id, to_entity_id")
    .eq("conference_id", conferenceId)
    .eq("role", "requires")
    .in("to_entity_id", policyIds);

  return (policies ?? []).map((p) => {
    const attrs = (p.attributes as Record<string, unknown> | null) ?? {};
    const acceptByRaw = attrs["accept_by"];
    return {
      policyEntityId: p.id,
      appliesToAll: attrs["applies_to_all"] === true,
      whoSourceRoles: (whoRefs ?? [])
        .filter((r) => r.from_entity_id === p.id)
        .map((r) => audienceRole.get(r.to_entity_id))
        .filter((x): x is string => Boolean(x)),
      requiredByEntityIds: (reqRefs ?? []).filter((r) => r.to_entity_id === p.id).map((r) => r.from_entity_id),
      acceptBy: acceptByRaw === "buyer" || acceptByRaw === "assignee" || acceptByRaw === "both" ? acceptByRaw : null,
    };
  });
}

/**
 * Core acceptance check (no auth): the document types `userId` still owes for a
 * conference, given an optional registrant context (audience/held/role). Pass
 * userId=null for someone with no account yet (they've accepted nothing).
 */
export async function computeMissingLegal(
  db: AdminClient,
  conferenceId: string,
  userId: string | null,
  registrant?: Registrant,
  /**
   * The person's contact. An acceptance taken at the check-in desk is recorded
   * for the PERSON (they may have no login), so it counts here too.
   */
  contactId?: string | null
): Promise<{ allAccepted: boolean; missing: string[]; missingVersionIds: string[] }> {
  const nowIso = new Date().toISOString();
  const { data: versions } = await db
    .from("conference_legal_versions")
    .select("id, document_type, policy_entity_id")
    .eq("conference_id", conferenceId)
    .lte("effective_at", nowIso)
    .order("document_type", { ascending: true })
    .order("version", { ascending: false });
  if (!versions || versions.length === 0) return { allAccepted: true, missing: [], missingVersionIds: [] };

  // Latest version per type, remembering each one's policy entity.
  const latestByType = new Map<string, string>();
  const policyByVersion = new Map<string, string | null>();
  for (const row of versions) {
    if (!latestByType.has(row.document_type)) {
      latestByType.set(row.document_type, row.id);
      policyByVersion.set(row.id, row.policy_entity_id ?? null);
    }
  }

  // With a registrant, only require the docs the catalog policy graph targets
  // at them; without one, fall back to every active doc.
  let requiredTypes = [...latestByType.entries()];
  if (registrant) {
    // ⛔ Exempt tiers short-circuit the whole walk, not just the targeting.
    // A policy with `applies_to_all` and a legal version with no policy entity
    // ("unmanaged → fail safe") both bypass targeting entirely, so filtering
    // per-policy would still have chased staff for two documents.
    if (isLegallyExempt(registrant)) return { allAccepted: true, missing: [], missingVersionIds: [] };
    const policies = await loadPolicyTargeting(db, conferenceId);
    const requiredPolicies = requiredPolicyEntityIds(policies, registrant);
    requiredTypes = requiredTypes.filter(([, versionId]) => {
      const policyId = policyByVersion.get(versionId) ?? null;
      return policyId == null || requiredPolicies.has(policyId); // unmanaged → fail safe
    });
  }
  const requiredVersionIds = requiredTypes.map(([, versionId]) => versionId);

  const acceptedIds = new Set<string>();
  const who = [userId ? `user_id.eq.${userId}` : null, contactId ? `contact_id.eq.${contactId}` : null].filter(Boolean);
  if (who.length > 0 && requiredVersionIds.length > 0) {
    const { data: acceptances } = await db
      .from("legal_acceptances")
      .select("legal_version_id")
      .or(who.join(","))
      .in("legal_version_id", requiredVersionIds);
    for (const row of acceptances ?? []) acceptedIds.add(row.legal_version_id);
  }

  const owed = requiredTypes.filter(([, versionId]) => !acceptedIds.has(versionId));
  return {
    allAccepted: owed.length === 0,
    missing: owed.map(([documentType]) => documentType),
    missingVersionIds: owed.map(([, versionId]) => versionId),
  };
}

/**
 * The audience tier an organisation's people are held to.
 *
 * ⛔ Resolved through the configured membership programs, never a string
 * literal (`organizations.type` is "Vendor Partner", capitalised). Only
 * `partner` and `staff` diverge from `member`; `staff` must pass through or the
 * staff exemption can never fire. resolveConferenceTier also feeds pricing, so
 * the narrowing happens here, not there. One copy, for every caller.
 */
export async function audienceForOrg(db: AdminClient, organizationId: string | null): Promise<string[]> {
  if (!organizationId) return ["member"];
  const { data: org } = await db.from("organizations").select("type").eq("id", organizationId).maybeSingle();
  const tier = resolveConferenceTier(org?.type, await getProgramsConfig());
  return [tier === "partner" || tier === "staff" ? tier : "member"];
}

export type OwedAgreement = { versionId: string; documentType: string; content: string };

/**
 * What one person on a conference's roster still has to accept, with the text
 * to show them. The check-in desk asks this on every badge (Stephen,
 * 2026-10-23: "if we haven't gotten them to do it by the time they are at the
 * door, that is our last shot"). Same rule as registration: their audience,
 * what they hold, the assignee moment; acceptances by their login OR for them.
 */
export async function personOwedAgreements(
  db: AdminClient,
  conferenceId: string,
  personId: string
): Promise<OwedAgreement[]> {
  const { data: person } = await db
    .from("conference_people")
    .select("user_id, organization_id, canonical_person_id")
    .eq("conference_id", conferenceId)
    .eq("id", personId)
    .maybeSingle();
  if (!person) return [];
  const [audienceSourceRoles, { seats }] = await Promise.all([
    audienceForOrg(db, (person.organization_id as string | null) ?? null),
    loadSeatHoldings(db, { conferenceId, holderPersonId: personId }),
  ]);
  const { missingVersionIds } = await computeMissingLegal(
    db,
    conferenceId,
    (person.user_id as string | null) ?? null,
    { audienceSourceRoles, heldEntityIds: [...new Set(seats.map((seat) => seat.entityId))], role: "assignee" },
    (person.canonical_person_id as string | null) ?? null
  );
  if (missingVersionIds.length === 0) return [];
  const { data: versions } = await db
    .from("conference_legal_versions")
    .select("id, document_type, content")
    .in("id", missingVersionIds)
    .order("document_type");
  return (versions ?? []).map((v) => ({
    versionId: v.id as string,
    documentType: v.document_type as string,
    content: v.content as string,
  }));
}

/**
 * Org-level rollup for the checklist engine: has every one of this org's
 * registered people (who have a platform account — an unassigned/imported
 * seat with no user_id can't have accepted anything, so it counts as
 * incomplete) accepted everything the catalog policy graph requires of them.
 * Mirrors getPersonAssigneeLegalGate's per-person registrant construction
 * (lib/actions/conference-legal.ts), just aggregated across the whole org
 * instead of gating one scanned attendee.
 */
export async function computeOrgLegalCompleteness(
  db: AdminClient,
  conferenceId: string,
  organizationId: string
): Promise<boolean> {
  const { data: people } = await db
    .from("conference_people")
    .select("id")
    .eq("conference_id", conferenceId)
    .eq("organization_id", organizationId);
  if (!people || people.length === 0) return false; // nobody registered yet — not complete

  // Per person, by the one rule the check-in desk uses: their login's
  // acceptances or ones taken for them at the desk (personOwedAgreements).
  for (const person of people) {
    if ((await personOwedAgreements(db, conferenceId, person.id as string)).length > 0) return false;
  }

  return true;
}
