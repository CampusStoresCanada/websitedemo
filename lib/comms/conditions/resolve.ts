// ─────────────────────────────────────────────────────────────────
// Chunk 22: Communications — Condition Subject Resolution (server-only)
// Given a resolved recipient, find the actual row a condition checks
// against. Kept separate from registry.ts so the registry's client-safe
// field metadata never has to share a module with real DB access.
// ─────────────────────────────────────────────────────────────────

import { createAdminClient } from "@/lib/supabase/admin";
import { evaluateChecklistTaskCheck, type CheckType } from "@/lib/conference/checklist-engine";
import type { ConditionSubjectKey } from "./registry";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface ConditionRecipient {
  userId: string | null;
  email: string;
}

/** Shared by "organization" and "checklist_task" — both need the recipient's active org membership. */
async function resolveRecipientOrgId(supabase: AdminClient, userId: string): Promise<string | null> {
  const { data: membership } = await supabase
    .from("user_organizations")
    .select("organization_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  return membership?.organization_id ?? null;
}

/**
 * Resolve the row a condition's field lives on. Returns null when the
 * subject can't be resolved for this recipient (no user_id, no org
 * membership, not registered for the referenced event, etc.) — callers
 * treat that as "condition is false", not an error.
 */
export async function resolveConditionSubjectRow(
  supabase: AdminClient,
  subject: ConditionSubjectKey,
  recipient: ConditionRecipient,
  referenceId?: string | null
): Promise<Record<string, unknown> | null> {
  switch (subject) {
    case "organization": {
      if (!recipient.userId) return null;
      const organizationId = await resolveRecipientOrgId(supabase, recipient.userId);
      if (!organizationId) return null;

      const { data: org } = await supabase
        .from("organizations")
        .select("*")
        .eq("id", organizationId)
        .maybeSingle();
      return org;
    }

    case "person": {
      if (!recipient.userId) return null;
      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", recipient.userId)
        .maybeSingle();
      return profile;
    }

    case "event_registration": {
      if (!recipient.userId || !referenceId) return null;
      const { data: registration } = await supabase
        .from("event_registrations")
        .select("*")
        .eq("user_id", recipient.userId)
        .eq("event_id", referenceId)
        .maybeSingle();
      return registration;
    }

    case "checklist_task": {
      // referenceId = conference_checklist_tasks.id. Completion is a
      // computed fact about the recipient's ORG (via the same CHECKS
      // registry the checklist reminder digest uses), not a stored column
      // — so this returns a synthetic single-field row rather than a real
      // table row, keeping the rest of the evaluate/operator pipeline
      // (which just reads row[field]) unchanged.
      if (!recipient.userId || !referenceId) return null;
      const organizationId = await resolveRecipientOrgId(supabase, recipient.userId);
      if (!organizationId) return null;

      const { data: task } = await supabase
        .from("conference_checklist_tasks")
        .select("check_type, check_entity_id, checklist:conference_checklists(conference_id)")
        .eq("id", referenceId)
        .maybeSingle();
      if (!task) return null;
      const checklist = Array.isArray(task.checklist) ? task.checklist[0] : task.checklist;
      if (!checklist) return null;

      const isComplete = await evaluateChecklistTaskCheck(
        supabase,
        task.check_type as CheckType,
        organizationId,
        checklist.conference_id,
        task.check_entity_id
      );
      return { is_complete: isComplete };
    }

    case "conference_entity_ownership": {
      // referenceId = conference_instances.id. owns_booth/owns_registration
      // are both computed off the same referenced conference in one query —
      // a synthetic row, same precedent as checklist_task's is_complete.
      if (!recipient.userId || !referenceId) return null;
      const organizationId = await resolveRecipientOrgId(supabase, recipient.userId);
      if (!organizationId) return null;

      // entity_balances is org-scoped (mint_v3_for_order always writes the
      // purchasing org's id) — kind-level ownership, not a specific booth
      // or registration tier, is what a "have they bought anything of this
      // kind yet" suppression gate actually needs.
      const { data: balances } = await supabase
        .from("entity_balances")
        .select("conference_entities!inner(kind)")
        .eq("organization_id", organizationId)
        .eq("conference_id", referenceId)
        .gt("quantity", 0);

      const ownedKinds = new Set(
        (balances ?? []).map((b) => {
          const entity = Array.isArray(b.conference_entities) ? b.conference_entities[0] : b.conference_entities;
          return entity?.kind;
        })
      );
      return { owns_booth: ownedKinds.has("booth"), owns_registration: ownedKinds.has("registration") };
    }

    default:
      return null;
  }
}
