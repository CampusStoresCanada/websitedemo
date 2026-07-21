"use server";

import {
  isGlobalAdmin,
  requireAdmin,
  requireAuthenticated,
  requireConferenceOpsAccess,
} from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
// Imported via relative path (not the "@/" alias) so the Vitest suite, which
// has no path-alias resolution, can load this module in unit tests.
import {
  isConferenceOnSale,
  LEGAL_DOCUMENT_LABELS,
  defaultAcceptByForDocument,
  type ConferenceStatus,
  type LegalDocumentType,
  type PolicyAcceptBy,
} from "../constants/conference";
import { requiredPolicyEntityIds, type Registrant } from "../conference/legal-policies";
import { loadPolicyTargeting, computeMissingLegal } from "../conference/legal-acceptance";
import type { Database } from "@/lib/database.types";

type LegalVersionRow = Database["public"]["Tables"]["conference_legal_versions"]["Row"];
type LegalVersionInsert = Database["public"]["Tables"]["conference_legal_versions"]["Insert"];
type LegalAcceptanceRow = Database["public"]["Tables"]["legal_acceptances"]["Row"];

export type { Registrant } from "../conference/legal-policies";

/**
 * Catalog entity ids a user holds for a conference (minted registration / booth
 * seats). Feeds offer-gated policy resolution. Empty until the buy-flow mints
 * seats, so offer-gated docs only surface once a registrant actually holds the
 * offer that `requires` them.
 */
export async function getHeldEntityIds(
  conferenceId: string,
  userId: string
): Promise<string[]> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return [];
  if (userId !== auth.ctx.userId && !isGlobalAdmin(auth.ctx.globalRole)) return [];

  const db = createAdminClient();
  const { data: people } = await db
    .from("conference_people")
    .select("id")
    .eq("conference_id", conferenceId)
    .eq("user_id", userId);
  const personIds = (people ?? []).map((p) => p.id);
  if (personIds.length === 0) return [];

  const { data: seats } = await db
    .from("entity_balance_seats")
    .select("entity_id")
    .eq("conference_id", conferenceId)
    .in("holder_person_id", personIds);
  return [...new Set((seats ?? []).map((s) => s.entity_id))];
}

// ─────────────────────────────────────────────────────────────────
// Public: Get the legal documents a specific registrant must accept
// (derived from the catalog policy graph — audience + held offers).
// ─────────────────────────────────────────────────────────────────

export async function getRequiredLegalDocuments(
  conferenceId: string,
  registrant: Registrant
): Promise<{ success: boolean; error?: string; data?: LegalVersionRow[] }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const { data, error } = await db
    .from("conference_legal_versions")
    .select("*")
    .eq("conference_id", conferenceId)
    .lte("effective_at", new Date().toISOString())
    .order("version", { ascending: false });
  if (error) return { success: false, error: error.message };

  const latestByType = new Map<string, LegalVersionRow>();
  for (const doc of data ?? []) {
    if (!latestByType.has(doc.document_type)) latestByType.set(doc.document_type, doc);
  }

  const policies = await loadPolicyTargeting(db, conferenceId);
  const required = requiredPolicyEntityIds(policies, registrant);

  // Docs with no policy entity (unmanaged) fail safe to "shown".
  const docs = [...latestByType.values()].filter(
    (doc) => doc.policy_entity_id == null || required.has(doc.policy_entity_id)
  );
  return { success: true, data: docs };
}

/**
 * Public: same resolution as getRequiredLegalDocuments, without the auth
 * check — for a registrant with no platform account yet (e.g. the anonymous
 * non-member Day Pass flow), there is no user to authenticate. Read-only and
 * conference-scoped, same as the other genuinely public catalog reads
 * (floor plan, offers).
 */
export async function getRequiredLegalDocumentsPublic(
  conferenceId: string,
  audienceSourceRoles: string[]
): Promise<{ success: boolean; error?: string; data?: LegalVersionRow[] }> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("conference_legal_versions")
    .select("*")
    .eq("conference_id", conferenceId)
    .lte("effective_at", new Date().toISOString())
    .order("version", { ascending: false });
  if (error) return { success: false, error: error.message };

  const latestByType = new Map<string, LegalVersionRow>();
  for (const doc of data ?? []) {
    if (!latestByType.has(doc.document_type)) latestByType.set(doc.document_type, doc);
  }

  const policies = await loadPolicyTargeting(db, conferenceId);
  const required = requiredPolicyEntityIds(policies, { audienceSourceRoles, heldEntityIds: [] });

  const docs = [...latestByType.values()].filter(
    (doc) => doc.policy_entity_id == null || required.has(doc.policy_entity_id)
  );
  return { success: true, data: docs };
}

// ─────────────────────────────────────────────────────────────────
// Admin: read & edit a document's catalog targeting
// ─────────────────────────────────────────────────────────────────

export type LegalDocTargeting = {
  documentType: string;
  policyEntityId: string | null;
  appliesToAll: boolean;
  whoAudienceIds: string[];
  requiredBy: { id: string; name: string; kind: string }[];
  acceptBy: PolicyAcceptBy | null;
};
export type LegalTargeting = {
  byDocumentType: Record<string, LegalDocTargeting>;
  audiences: { id: string; name: string; sourceRole: string | null }[];
};

export async function getLegalTargeting(
  conferenceId: string
): Promise<{ success: boolean; error?: string; data?: LegalTargeting }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };
  const db = createAdminClient();

  const { data: versions } = await db
    .from("conference_legal_versions")
    .select("document_type, policy_entity_id")
    .eq("conference_id", conferenceId);
  const policyByType = new Map<string, string | null>();
  for (const v of versions ?? []) {
    if (!policyByType.get(v.document_type)) policyByType.set(v.document_type, v.policy_entity_id ?? null);
  }
  const policyIds = [...new Set([...policyByType.values()].filter((x): x is string => Boolean(x)))];

  const appliesAll = new Map<string, boolean>();
  const acceptByByPolicy = new Map<string, PolicyAcceptBy | null>();
  const whoByPolicy = new Map<string, string[]>();
  const reqByPolicy = new Map<string, { id: string; name: string; kind: string }[]>();
  if (policyIds.length) {
    const { data: pol } = await db.from("conference_entities").select("id, attributes").in("id", policyIds);
    for (const p of pol ?? []) {
      const attrs = (p.attributes as Record<string, unknown> | null) ?? {};
      appliesAll.set(p.id, attrs["applies_to_all"] === true);
      const ab = attrs["accept_by"];
      acceptByByPolicy.set(p.id, ab === "buyer" || ab === "assignee" || ab === "both" ? ab : null);
    }

    const { data: whoRefs } = await db
      .from("conference_entity_refs")
      .select("from_entity_id, to_entity_id")
      .eq("conference_id", conferenceId).eq("role", "who").in("from_entity_id", policyIds);
    for (const r of whoRefs ?? []) {
      whoByPolicy.set(r.from_entity_id, [...(whoByPolicy.get(r.from_entity_id) ?? []), r.to_entity_id]);
    }

    const { data: reqRefs } = await db
      .from("conference_entity_refs")
      .select("from_entity_id, to_entity_id")
      .eq("conference_id", conferenceId).eq("role", "requires").in("to_entity_id", policyIds);
    const fromIds = [...new Set((reqRefs ?? []).map((r) => r.from_entity_id))];
    const nameById = new Map<string, { name: string; kind: string }>();
    if (fromIds.length) {
      const { data: ents } = await db.from("conference_entities").select("id, name, kind").in("id", fromIds);
      for (const e of ents ?? []) nameById.set(e.id, { name: e.name, kind: e.kind });
    }
    for (const r of reqRefs ?? []) {
      const info = nameById.get(r.from_entity_id);
      reqByPolicy.set(r.to_entity_id, [
        ...(reqByPolicy.get(r.to_entity_id) ?? []),
        { id: r.from_entity_id, name: info?.name ?? "", kind: info?.kind ?? "" },
      ]);
    }
  }

  const { data: auds } = await db
    .from("conference_entities").select("id, name, attributes")
    .eq("conference_id", conferenceId).eq("kind", "audience").order("name");
  const audiences = (auds ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    sourceRole: ((a.attributes as Record<string, unknown> | null)?.["source_role"] as string | undefined) ?? null,
  }));

  const byDocumentType: Record<string, LegalDocTargeting> = {};
  for (const [documentType, policyEntityId] of policyByType) {
    byDocumentType[documentType] = {
      documentType,
      policyEntityId,
      appliesToAll: policyEntityId ? appliesAll.get(policyEntityId) ?? false : false,
      whoAudienceIds: policyEntityId ? whoByPolicy.get(policyEntityId) ?? [] : [],
      requiredBy: policyEntityId ? reqByPolicy.get(policyEntityId) ?? [] : [],
      acceptBy: policyEntityId ? acceptByByPolicy.get(policyEntityId) ?? null : null,
    };
  }
  return { success: true, data: { byDocumentType, audiences } };
}

export async function setPolicyAppliesToAll(
  policyEntityId: string,
  value: boolean
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };
  const db = createAdminClient();
  const { data: ent, error: e1 } = await db
    .from("conference_entities").select("attributes").eq("id", policyEntityId).maybeSingle();
  if (e1) return { success: false, error: e1.message };
  if (!ent) return { success: false, error: "Policy not found." };
  const attrs: Record<string, string | number | boolean | null> = {
    ...((ent.attributes as Record<string, string | number | boolean | null> | null) ?? {}),
  };
  if (value) attrs["applies_to_all"] = true;
  else delete attrs["applies_to_all"];
  const { error } = await db.from("conference_entities").update({ attributes: attrs }).eq("id", policyEntityId);
  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function setPolicyAcceptBy(
  policyEntityId: string,
  value: PolicyAcceptBy
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };
  const db = createAdminClient();
  const { data: ent, error: e1 } = await db
    .from("conference_entities").select("attributes").eq("id", policyEntityId).maybeSingle();
  if (e1) return { success: false, error: e1.message };
  if (!ent) return { success: false, error: "Policy not found." };
  const attrs: Record<string, string | number | boolean | null> = {
    ...((ent.attributes as Record<string, string | number | boolean | null> | null) ?? {}),
    accept_by: value,
  };
  const { error } = await db.from("conference_entities").update({ attributes: attrs }).eq("id", policyEntityId);
  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function setPolicyWhoAudiences(
  conferenceId: string,
  policyEntityId: string,
  audienceEntityIds: string[]
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };
  const db = createAdminClient();
  // Replace only the policy's outgoing `who` edges, leaving any others intact.
  const { error: delErr } = await db
    .from("conference_entity_refs").delete()
    .eq("from_entity_id", policyEntityId).eq("role", "who");
  if (delErr) return { success: false, error: delErr.message };
  if (audienceEntityIds.length) {
    const { error: insErr } = await db.from("conference_entity_refs").insert(
      audienceEntityIds.map((to) => ({
        conference_id: conferenceId,
        from_entity_id: policyEntityId,
        to_entity_id: to,
        role: "who",
        quantity: null,
      }))
    );
    if (insErr) return { success: false, error: insErr.message };
  }
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────
// Seat activation gate (STUB — ready to wire)
//
// When a `pending_user_activation` seat is being activated, the assignee must
// accept the assignee-level documents for what they hold before they become an
// active participant. This computes that gate; wiring its result into the
// activation step (assignConferenceEntitlement / the activation page) is the
// remaining step once the assignee notification + activation flow exists.
// ─────────────────────────────────────────────────────────────────

export async function getSeatAssigneeLegalGate(
  conferenceId: string,
  userId: string,
  audienceSourceRoles: string[]
): Promise<{ success: boolean; error?: string; data?: { allAccepted: boolean; missing: string[] } }> {
  const heldEntityIds = await getHeldEntityIds(conferenceId, userId);
  return checkLegalAcceptance(userId, conferenceId, {
    audienceSourceRoles,
    heldEntityIds,
    role: "assignee",
  });
}

/**
 * Resolve a user's assignee context in a conference: whether they actually hold
 * an assigned seat (a conference_people row), and the audience tier of the org
 * that owns it. Non-assignees have no assignee obligations, so the gate no-ops.
 */
async function deriveAssigneeContext(
  db: ReturnType<typeof createAdminClient>,
  conferenceId: string,
  userId: string
): Promise<{ isAssignee: boolean; audienceSourceRoles: string[] }> {
  const { data: cp } = await db
    .from("conference_people")
    .select("organization_id")
    .eq("conference_id", conferenceId)
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (!cp) return { isAssignee: false, audienceSourceRoles: [] };
  let audienceSourceRoles = ["member"];
  if (cp.organization_id) {
    const { data: org } = await db
      .from("organizations")
      .select("type")
      .eq("id", cp.organization_id)
      .maybeSingle();
    if (org?.type === "vendor_partner") audienceSourceRoles = ["partner"];
  }
  return { isAssignee: true, audienceSourceRoles };
}

/**
 * The assignee legal gate for the *current* user in a conference — what they
 * must accept (as an assignee/attendee) before participating. Self-deriving:
 * the audience tier comes from the org that owns their seat (vendor_partner →
 * partner, else member). This is the gate an assignee-facing surface calls.
 */
export async function getMyConferenceLegalGate(
  conferenceId: string
): Promise<{ success: boolean; error?: string; data?: { allAccepted: boolean; missing: string[] } }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };
  const db = createAdminClient();
  const { isAssignee, audienceSourceRoles } = await deriveAssigneeContext(db, conferenceId, auth.ctx.userId);
  if (!isAssignee) return { success: true, data: { allAccepted: true, missing: [] } };
  return getSeatAssigneeLegalGate(conferenceId, auth.ctx.userId, audienceSourceRoles);
}

/**
 * The assignee legal documents (full content) the current user must accept in a
 * conference. Powers the assignee acceptance page. Self-deriving audience.
 */
export async function getMyRequiredLegalDocuments(
  conferenceId: string
): Promise<{ success: boolean; error?: string; data?: LegalVersionRow[] }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };
  const db = createAdminClient();
  const { isAssignee, audienceSourceRoles } = await deriveAssigneeContext(db, conferenceId, auth.ctx.userId);
  if (!isAssignee) return { success: true, data: [] };
  const heldEntityIds = await getHeldEntityIds(conferenceId, auth.ctx.userId);
  return getRequiredLegalDocuments(conferenceId, {
    audienceSourceRoles,
    heldEntityIds,
    role: "assignee",
  });
}

// ─────────────────────────────────────────────────────────────────
// Public: Get active legal documents for a conference
// ─────────────────────────────────────────────────────────────────

export async function getActiveLegalDocuments(
  conferenceId: string
): Promise<{ success: boolean; error?: string; data?: LegalVersionRow[] }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  // Get the latest version of each document type for this conference
  const { data, error } = await auth.ctx.supabase
    .from("conference_legal_versions")
    .select("*")
    .eq("conference_id", conferenceId)
    .lte("effective_at", new Date().toISOString())
    .order("version", { ascending: false });

  if (error) return { success: false, error: error.message };

  // Keep only the latest version per document_type
  const latestByType = new Map<string, LegalVersionRow>();
  for (const doc of data ?? []) {
    if (!latestByType.has(doc.document_type)) {
      latestByType.set(doc.document_type, doc);
    }
  }

  return { success: true, data: Array.from(latestByType.values()) };
}

// ─────────────────────────────────────────────────────────────────
// Admin: Create a legal version
// ─────────────────────────────────────────────────────────────────

/**
 * Ensure a `policy` entity exists for a document type and that every version of
 * that type points to it, so the doc is targetable in the catalog. Best-effort:
 * a failure here never blocks creating the legal version itself.
 */
async function ensurePolicyEntityForDocument(
  db: ReturnType<typeof createAdminClient>,
  conferenceId: string,
  documentType: string
): Promise<void> {
  const { data: existing } = await db
    .from("conference_legal_versions")
    .select("policy_entity_id")
    .eq("conference_id", conferenceId)
    .eq("document_type", documentType)
    .not("policy_entity_id", "is", null)
    .limit(1)
    .maybeSingle();

  let policyId = existing?.policy_entity_id ?? null;
  if (!policyId) {
    const name = LEGAL_DOCUMENT_LABELS[documentType as LegalDocumentType] ?? documentType;
    const { data: created } = await db
      .from("conference_entities")
      .insert({
        conference_id: conferenceId,
        kind: "policy",
        name,
        is_for_sale: false,
        currency: "CAD",
        attributes: {
          legal_document_type: documentType,
          accept_by: defaultAcceptByForDocument(documentType),
        },
      })
      .select("id")
      .single();
    policyId = created?.id ?? null;
  }
  if (policyId) {
    await db
      .from("conference_legal_versions")
      .update({ policy_entity_id: policyId })
      .eq("conference_id", conferenceId)
      .eq("document_type", documentType)
      .is("policy_entity_id", null);
  }
}

export async function createLegalVersion(
  input: Omit<LegalVersionInsert, "id" | "created_at" | "created_by">
): Promise<{ success: boolean; error?: string; data?: LegalVersionRow }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("conference_legal_versions")
    .insert({ ...input, created_by: auth.ctx.userId })
    .select()
    .single();

  if (error) return { success: false, error: error.message };

  // Make sure the document is represented in the catalog so it can be targeted.
  await ensurePolicyEntityForDocument(adminClient, input.conference_id, input.document_type);
  return { success: true, data };
}

// ─────────────────────────────────────────────────────────────────
// Admin: Edit a legal version in place (only before the conference is on sale)
//
// Once registration opens, attendees can accept a specific version, so mutating
// its content would silently change what they agreed to. After that point the
// only safe path is to add a new version, which supersedes the old one while
// leaving prior acceptances intact. We therefore only allow in-place edits while
// the conference is still a draft.
// ─────────────────────────────────────────────────────────────────

export async function updateLegalVersion(
  versionId: string,
  input: Pick<LegalVersionInsert, "document_type" | "version" | "content" | "effective_at">
): Promise<{ success: boolean; error?: string; data?: LegalVersionRow }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();

  const { data: existing, error: existingError } = await adminClient
    .from("conference_legal_versions")
    .select("conference_id")
    .eq("id", versionId)
    .maybeSingle();
  if (existingError) return { success: false, error: existingError.message };
  if (!existing) return { success: false, error: "Legal document version not found." };

  const { data: conference, error: conferenceError } = await adminClient
    .from("conference_instances")
    .select("status")
    .eq("id", existing.conference_id)
    .maybeSingle();
  if (conferenceError) return { success: false, error: conferenceError.message };
  if (!conference) return { success: false, error: "Conference not found." };

  if (isConferenceOnSale(conference.status as ConferenceStatus)) {
    return {
      success: false,
      error:
        "This conference is on sale, so legal documents can no longer be edited in place. Add a new version instead to preserve existing acceptances.",
    };
  }

  const { data, error } = await adminClient
    .from("conference_legal_versions")
    .update({
      document_type: input.document_type,
      version: input.version,
      content: input.content,
      effective_at: input.effective_at,
    })
    .eq("id", versionId)
    .select()
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, data };
}

// ─────────────────────────────────────────────────────────────────
// Admin: Get all legal versions for a conference
// ─────────────────────────────────────────────────────────────────

export async function getLegalVersions(
  conferenceId: string
): Promise<{ success: boolean; error?: string; data?: LegalVersionRow[] }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("conference_legal_versions")
    .select("*")
    .eq("conference_id", conferenceId)
    .order("document_type")
    .order("version", { ascending: false });

  if (error) return { success: false, error: error.message };
  return { success: true, data: data ?? [] };
}

// ─────────────────────────────────────────────────────────────────
// Authenticated: Accept a legal document
// ─────────────────────────────────────────────────────────────────

export async function acceptLegalDocument(
  legalVersionId: string,
  ipAddress?: string
): Promise<{ success: boolean; error?: string; data?: LegalAcceptanceRow }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };
  return recordLegalAcceptance(auth.ctx.userId, legalVersionId, ipAddress);
}

// ─────────────────────────────────────────────────────────────────
// Authenticated/Admin: Record legal acceptance for a user
// ─────────────────────────────────────────────────────────────────

export async function recordLegalAcceptance(
  userId: string,
  legalVersionId: string,
  ipAddress?: string
): Promise<{ success: boolean; error?: string; data?: LegalAcceptanceRow }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };
  if (userId !== auth.ctx.userId && !isGlobalAdmin(auth.ctx.globalRole)) {
    return { success: false, error: "Not authorized to record this acceptance" };
  }

  const adminClient = createAdminClient();

  // Upsert — if already accepted, just return success
  const { data: existing } = await adminClient
    .from("legal_acceptances")
    .select("*")
    .eq("user_id", userId)
    .eq("legal_version_id", legalVersionId)
    .maybeSingle();

  if (existing) {
    return { success: true, data: existing };
  }

  const { data, error } = await adminClient
    .from("legal_acceptances")
    .insert({
      user_id: userId,
      legal_version_id: legalVersionId,
      ip_address: ipAddress ?? null,
    })
    .select()
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, data };
}

// ─────────────────────────────────────────────────────────────────
// Authenticated/Admin: Check legal acceptance completeness
// ─────────────────────────────────────────────────────────────────

export async function checkLegalAcceptance(
  userId: string,
  conferenceId: string,
  registrant?: Registrant
): Promise<{ success: boolean; error?: string; data?: { allAccepted: boolean; missing: string[] } }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };
  if (userId !== auth.ctx.userId && !isGlobalAdmin(auth.ctx.globalRole)) {
    return { success: false, error: "Not authorized to view this acceptance state" };
  }
  const data = await computeMissingLegal(createAdminClient(), conferenceId, userId, registrant);
  return { success: true, data };
}

/**
 * Assignee legal gate for a specific conference_people row — used staff-side
 * (e.g. check-in) to verify the scanned attendee has accepted their personal
 * documents. Guarded by conference-ops access (matches the check-in surface).
 */
export async function getPersonAssigneeLegalGate(
  conferenceId: string,
  personId: string
): Promise<{ success: boolean; error?: string; data?: { allAccepted: boolean; missing: string[] } }> {
  const auth = await requireConferenceOpsAccess();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const { data: person } = await db
    .from("conference_people")
    .select("user_id, organization_id")
    .eq("conference_id", conferenceId)
    .eq("id", personId)
    .maybeSingle();
  if (!person) return { success: false, error: "Person not found." };

  let audienceSourceRoles = ["member"];
  if (person.organization_id) {
    const { data: org } = await db
      .from("organizations")
      .select("type")
      .eq("id", person.organization_id)
      .maybeSingle();
    if (org?.type === "vendor_partner") audienceSourceRoles = ["partner"];
  }
  const { data: seats } = await db
    .from("entity_balance_seats")
    .select("entity_id")
    .eq("conference_id", conferenceId)
    .eq("holder_person_id", personId);
  const heldEntityIds = [...new Set((seats ?? []).map((s) => s.entity_id))];

  const data = await computeMissingLegal(db, conferenceId, person.user_id ?? null, {
    audienceSourceRoles,
    heldEntityIds,
    role: "assignee",
  });
  return { success: true, data };
}

// ─────────────────────────────────────────────────────────────────
// Admin: Acceptance stats for one legal version
// ─────────────────────────────────────────────────────────────────

export async function getLegalAcceptanceStats(
  legalVersionId: string
): Promise<{
  success: boolean;
  error?: string;
  data?: { total: number; accepted: number; pending: number };
}> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { data: legalVersion, error: legalVersionError } = await adminClient
    .from("conference_legal_versions")
    .select("id, conference_id")
    .eq("id", legalVersionId)
    .maybeSingle();
  if (legalVersionError) return { success: false, error: legalVersionError.message };
  if (!legalVersion) return { success: false, error: "Legal version not found" };

  const [registrationsRes, acceptancesRes] = await Promise.all([
    adminClient
      .from("conference_registrations")
      .select("user_id")
      .eq("conference_id", legalVersion.conference_id)
      .in("status", ["submitted", "confirmed"]),
    adminClient
      .from("legal_acceptances")
      .select("user_id")
      .eq("legal_version_id", legalVersionId),
  ]);

  if (registrationsRes.error) {
    return { success: false, error: registrationsRes.error.message };
  }
  if (acceptancesRes.error) {
    return { success: false, error: acceptancesRes.error.message };
  }

  const requiredUsers = new Set(
    (registrationsRes.data ?? []).map((row) => row.user_id)
  );
  const acceptedUsers = new Set(
    (acceptancesRes.data ?? [])
      .map((row) => row.user_id)
      .filter((userId) => requiredUsers.has(userId))
  );
  const total = requiredUsers.size;
  const accepted = acceptedUsers.size;
  const pending = Math.max(0, total - accepted);
  return { success: true, data: { total, accepted, pending } };
}

// ─────────────────────────────────────────────────────────────────
// Authenticated: Get my legal acceptances for a conference
// ─────────────────────────────────────────────────────────────────

export async function getMyLegalAcceptances(
  conferenceId: string
): Promise<{ success: boolean; error?: string; data?: LegalAcceptanceRow[] }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  // Get legal version IDs for this conference
  const { data: versions, error: verErr } = await auth.ctx.supabase
    .from("conference_legal_versions")
    .select("id")
    .eq("conference_id", conferenceId);

  if (verErr) return { success: false, error: verErr.message };

  if (!versions || versions.length === 0) {
    return { success: true, data: [] };
  }

  const { data, error } = await auth.ctx.supabase
    .from("legal_acceptances")
    .select("*")
    .eq("user_id", auth.ctx.userId)
    .in(
      "legal_version_id",
      versions.map((v) => v.id)
    );

  if (error) return { success: false, error: error.message };
  return { success: true, data: data ?? [] };
}
