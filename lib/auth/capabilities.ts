import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Capability grants — narrow, time-boxed, attributed permissions.
 *
 * A grant is not a role. Roles persist until someone remembers to remove them;
 * grants dissolve on their own. Anything that should be permanent belongs in
 * `profiles.global_role`, not here.
 *
 * Naming is dotted and specific — `benchmarking.content_review`, never
 * `benchmarking.admin`. If a capability needs a comment to explain what it
 * covers, it is too broad; split it.
 */
export const CAPABILITIES = {
  /** Store directors reviewing question wording and authoring worked examples. */
  BENCHMARKING_CONTENT_REVIEW: "benchmarking.content_review",
  /** Board committee resolving delta flags and verifying submissions. */
  BENCHMARKING_QA_VERIFY: "benchmarking.qa_verify",
  /** Regional reps confirming the right respondent per member store. */
  BENCHMARKING_RECIPIENT_CONFIRM: "benchmarking.recipient_confirm",
} as const;

export type Capability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES];

export interface CapabilityGrant {
  id: string;
  subjectId: string;
  subjectName: string;
  capability: string;
  scopeType: string | null;
  scopeId: string | null;
  reason: string;
  grantedByName: string | null;
  startsAt: string;
  endsAt: string;
  revokedAt: string | null;
  isActive: boolean;
}

/**
 * Does this person hold an unexpired, unrevoked grant for this capability?
 *
 * Delegates to the SQL function so the definition of "active" lives in one
 * place and RLS policies can use the same rule.
 */
export async function hasCapability(
  subjectId: string,
  capability: Capability,
  scopeId?: string | null,
): Promise<boolean> {
  const db = createAdminClient();
  const { data, error } = await db.rpc("has_capability", {
    p_subject: subjectId,
    p_capability: capability,
    p_scope_id: scopeId ?? undefined,
  });

  if (error) {
    // Fail closed. A capability check that errors must not grant access.
    console.error("[capabilities] has_capability failed:", error);
    return false;
  }
  return data === true;
}

/** Every capability this person currently holds. */
export async function activeCapabilities(subjectId: string): Promise<string[]> {
  const db = createAdminClient();
  const nowIso = new Date().toISOString();
  const { data, error } = await db
    .from("capability_grants")
    .select("capability")
    .eq("subject_id", subjectId)
    .is("revoked_at", null)
    .lte("starts_at", nowIso)
    .gt("ends_at", nowIso);

  if (error) {
    console.error("[capabilities] activeCapabilities failed:", error);
    return [];
  }
  return Array.from(
    new Set((data ?? []).map((r: { capability: string }) => r.capability)),
  );
}
