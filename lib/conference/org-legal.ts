import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticated, canManageOrganization } from "@/lib/auth/guards";
import { getProgramsConfig, resolveConferenceTier } from "@/lib/policy/engine";
import { loadPolicyTargeting } from "./legal-acceptance";
import { requiredPolicyEntityIds } from "./legal-policies";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * The agreements an organisation is facing, split by WHO has to accept them.
 *
 * The split is the whole point. Of the six policies on CSC 2027, two are the
 * buyer's — the person who bought the booth signs the Exhibitor Agreement —
 * and four are each attendee's own. An org admin cannot accept a code of
 * conduct on behalf of their staff, and `recordLegalAcceptance` correctly
 * refuses to let them: it records against the authenticated user and rejects
 * any other user id unless you are a global admin.
 *
 * So the org page needs two different things: buttons for what the admin owes,
 * and a roster for what their people owe. Presenting one list would imply the
 * admin can clear all of it, which is exactly the mistake the consent work
 * corrected elsewhere — the company answers for the company, people answer for
 * themselves.
 */

export type OrgLegalDoc = {
  versionId: string;
  documentType: string;
  title: string;
  content: string;
  /** buyer | assignee | both | null (unmanaged — treated as everyone's) */
  acceptBy: string | null;
  acceptedByViewer: boolean;
  acceptedAt: string | null;
};

export type AssigneeLegalStatus = {
  personId: string;
  name: string;
  /** No account yet, so they cannot have accepted anything. */
  hasAccount: boolean;
  outstanding: number;
};

export type OrgLegalStatus = {
  /** The viewer's own to accept — buyer and both. */
  mine: OrgLegalDoc[];
  /** Titles each attendee accepts for themselves. */
  theirsTitles: string[];
  people: AssigneeLegalStatus[];
};

const TITLES: Record<string, string> = {
  code_of_conduct: "Vendor Code of Conduct",
  member_code_of_conduct: "Member Code of Conduct",
  exhibitor_agreement: "Exhibitor & Booth Agreement",
  privacy_notice: "Privacy & Recording Release",
  speaker_agreement: "Speaker & Presenter Agreement",
  terms_and_conditions: "Terms & Conditions",
};

const titleFor = (documentType: string) =>
  TITLES[documentType] ??
  documentType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export async function loadOrgLegalStatus(
  db: AdminClient,
  conferenceId: string,
  organizationId: string,
  viewerUserId: string
): Promise<OrgLegalStatus> {
  // Defence in depth. Today the only caller is a page that has already run
  // requireOrgAdminOrSuperAdmin, but this returns payment and agreement data
  // for a named organisation — if it is ever called from a route that forgets
  // to guard, that is a leak with no error to notice. Cheap to re-check.
  const auth = await requireAuthenticated();
  if (!auth.ok || !canManageOrganization(auth.ctx, organizationId)) {
    throw new Error("Not authorized for this organization");
  }

  const nowIso = new Date().toISOString();
  const { data: versions } = await db
    .from("conference_legal_versions")
    .select("id, document_type, content, policy_entity_id, version")
    .eq("conference_id", conferenceId)
    .lte("effective_at", nowIso)
    .order("version", { ascending: false });

  // One live document per type — a superseded version is not a second thing to
  // accept, it is the same obligation at an older wording.
  type VersionRow = {
    id: string; document_type: string; content: string | null;
    policy_entity_id: string | null; version: number;
  };
  const latestByType = new Map<string, VersionRow>();
  for (const v of (versions ?? []) as VersionRow[]) {
    if (!latestByType.has(v.document_type)) latestByType.set(v.document_type, v);
  }
  if (latestByType.size === 0) return { mine: [], theirsTitles: [], people: [] };

  const { data: org } = await db
    .from("organizations")
    .select("type")
    .eq("id", organizationId)
    .maybeSingle();
  const programs = await getProgramsConfig();
  const audienceSourceRoles = [resolveConferenceTier(org?.type, programs)];

  const policies = await loadPolicyTargeting(db, conferenceId);
  const required = requiredPolicyEntityIds(policies, { audienceSourceRoles, heldEntityIds: [] });

  // accept_by lives on the policy entity's attributes.
  const policyIds = [...latestByType.values()]
    .map((v) => v.policy_entity_id)
    .filter((id): id is string => !!id);
  const { data: policyEntities } = policyIds.length
    ? await db.from("conference_entities").select("id, attributes").in("id", policyIds)
    : { data: [] };
  const acceptByPolicy = new Map(
    (policyEntities ?? []).map((p) => [
      p.id,
      ((p.attributes as Record<string, unknown> | null)?.["accept_by"] as string | undefined) ?? null,
    ])
  );

  const { data: mineAccepted } = await db
    .from("legal_acceptances")
    .select("legal_version_id, accepted_at")
    .eq("user_id", viewerUserId);
  const acceptedAtByVersion = new Map(
    (mineAccepted ?? []).map((a) => [a.legal_version_id, a.accepted_at as string | null])
  );

  const mine: OrgLegalDoc[] = [];
  const theirsTitles: string[] = [];

  for (const v of latestByType.values()) {
    // A document with no policy entity is unmanaged and fails safe to shown,
    // matching getRequiredLegalDocuments.
    if (v.policy_entity_id && !required.has(v.policy_entity_id)) continue;
    const acceptBy = v.policy_entity_id ? acceptByPolicy.get(v.policy_entity_id) ?? null : null;
    const title = titleFor(v.document_type);

    if (acceptBy === "assignee") {
      theirsTitles.push(title);
      continue;
    }
    // buyer, both, or unmanaged — the person acting for the company signs.
    mine.push({
      versionId: v.id,
      documentType: v.document_type,
      title,
      content: v.content ?? "",
      acceptBy,
      acceptedByViewer: acceptedAtByVersion.has(v.id),
      acceptedAt: acceptedAtByVersion.get(v.id) ?? null,
    });
    // "both" also lands on every attendee, so it belongs in their list too.
    if (acceptBy === "both") theirsTitles.push(title);
  }

  const { data: peopleRows } = await db
    .from("conference_people")
    .select("id, display_name, contact_email, user_id, assignment_status")
    .eq("conference_id", conferenceId)
    .eq("organization_id", organizationId);

  const assigneeVersionIds = [...latestByType.values()]
    .filter((v) => {
      if (v.policy_entity_id && !required.has(v.policy_entity_id)) return false;
      const ab = v.policy_entity_id ? acceptByPolicy.get(v.policy_entity_id) ?? null : null;
      return ab === "assignee" || ab === "both";
    })
    .map((v) => v.id);

  const userIds = (peopleRows ?? [])
    .map((p) => p.user_id)
    .filter((id): id is string => !!id);
  const { data: allAcceptances } = userIds.length && assigneeVersionIds.length
    ? await db
        .from("legal_acceptances")
        .select("user_id, legal_version_id")
        .in("user_id", userIds)
        .in("legal_version_id", assigneeVersionIds)
    : { data: [] };
  const acceptedByUser = new Map<string, Set<string>>();
  for (const a of allAcceptances ?? []) {
    const set = acceptedByUser.get(a.user_id) ?? new Set<string>();
    set.add(a.legal_version_id);
    acceptedByUser.set(a.user_id, set);
  }

  const people: AssigneeLegalStatus[] = (peopleRows ?? [])
    .filter((p) => p.assignment_status !== "canceled")
    .map((p) => {
      const accepted = p.user_id ? acceptedByUser.get(p.user_id) ?? new Set<string>() : new Set<string>();
      return {
        personId: p.id,
        name: p.display_name ?? p.contact_email ?? "Unnamed",
        hasAccount: !!p.user_id,
        outstanding: assigneeVersionIds.filter((id) => !accepted.has(id)).length,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return { mine, theirsTitles, people };
}
