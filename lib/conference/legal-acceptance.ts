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
import { getProgramsConfig, resolveConferenceTier } from "@/lib/policy/engine";
import {
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
  registrant?: Registrant
): Promise<{ allAccepted: boolean; missing: string[] }> {
  const nowIso = new Date().toISOString();
  const { data: versions } = await db
    .from("conference_legal_versions")
    .select("id, document_type, policy_entity_id")
    .eq("conference_id", conferenceId)
    .lte("effective_at", nowIso)
    .order("document_type", { ascending: true })
    .order("version", { ascending: false });
  if (!versions || versions.length === 0) return { allAccepted: true, missing: [] };

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
    const policies = await loadPolicyTargeting(db, conferenceId);
    const requiredPolicies = requiredPolicyEntityIds(policies, registrant);
    requiredTypes = requiredTypes.filter(([, versionId]) => {
      const policyId = policyByVersion.get(versionId) ?? null;
      return policyId == null || requiredPolicies.has(policyId); // unmanaged → fail safe
    });
  }
  const requiredVersionIds = requiredTypes.map(([, versionId]) => versionId);

  let acceptedIds = new Set<string>();
  if (userId) {
    const { data: acceptances } = await db
      .from("legal_acceptances")
      .select("legal_version_id")
      .eq("user_id", userId)
      .in("legal_version_id", requiredVersionIds);
    acceptedIds = new Set((acceptances ?? []).map((row) => row.legal_version_id));
  }

  const missing = requiredTypes.filter(([, versionId]) => !acceptedIds.has(versionId)).map(([documentType]) => documentType);
  return { allAccepted: missing.length === 0, missing };
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
    .select("id, user_id")
    .eq("conference_id", conferenceId)
    .eq("organization_id", organizationId);
  if (!people || people.length === 0) return false; // nobody registered yet — not complete

  const { data: org } = await db.from("organizations").select("type").eq("id", organizationId).maybeSingle();
  // `organizations.type` is capitalised and human-readable — "Vendor Partner",
  // "Member", "Non-Member". A snake_case literal here silently never matched, so
  // every vendor partner was evaluated against MEMBER-targeted policies and asked
  // to accept the wrong documents. Resolve through the configured programs
  // instead of comparing strings, so the mapping stays correct if the org types
  // are ever renamed or a third program is added.
  const programs = await getProgramsConfig();
  const audienceSourceRoles = [resolveConferenceTier(org?.type, programs)];

  for (const person of people) {
    if (!person.user_id) return false; // no account yet — can't have accepted anything

    const { data: seats } = await db
      .from("entity_balance_seats")
      .select("entity_id")
      .eq("conference_id", conferenceId)
      .eq("holder_person_id", person.id);
    const heldEntityIds = [...new Set((seats ?? []).map((s) => s.entity_id))];

    const { allAccepted } = await computeMissingLegal(db, conferenceId, person.user_id, {
      audienceSourceRoles,
      heldEntityIds,
    });
    if (!allAccepted) return false;
  }

  return true;
}
