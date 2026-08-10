// ─────────────────────────────────────────────────────────────────
// Chunk 22: Communications — Condition Subject Resolution (server-only)
// Given a group of recipients, find the actual rows a condition checks
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

/**
 * Active org membership for every given user, in one query — shared by
 * "organization", "checklist_task", and "conference_entity_ownership",
 * all of which need the recipient's org before they can look up anything
 * else. A user can admin more than one org; first match wins, same as
 * before this was batched.
 */
async function resolveOrgIdsForUsers(supabase: AdminClient, userIds: string[]): Promise<Map<string, string>> {
  const orgIdByUserId = new Map<string, string>();
  if (userIds.length === 0) return orgIdByUserId;

  const { data } = await supabase
    .from("user_organizations")
    .select("user_id, organization_id")
    .in("user_id", userIds)
    .eq("status", "active");

  for (const row of data ?? []) {
    if (row.user_id && row.organization_id && !orgIdByUserId.has(row.user_id)) {
      orgIdByUserId.set(row.user_id, row.organization_id);
    }
  }
  return orgIdByUserId;
}

/**
 * Resolve the row a condition's field lives on, for every given recipient
 * at once — one batched query per subject, not one round trip per
 * recipient. A segmentation gate or a send can touch hundreds of
 * recipients in a single request; resolving them one at a time here used
 * to fan out into hundreds of concurrent Supabase calls in a single
 * Promise.all, which was slow and — in Next's dev server — could blow the
 * async-call-stack tracking Next uses for its error overlay.
 *
 * Returns a map keyed by userId. Recipients with no userId, or whose
 * subject can't be resolved (no org membership, not registered for the
 * referenced event, etc.), simply have no entry — callers treat a
 * missing entry as "condition is false", not an error.
 */
export async function resolveConditionSubjectRows(
  supabase: AdminClient,
  subject: ConditionSubjectKey,
  recipients: ConditionRecipient[],
  referenceId?: string | null
): Promise<Map<string, Record<string, unknown>>> {
  const rows = new Map<string, Record<string, unknown>>();
  const userIds = [...new Set(recipients.map((r) => r.userId).filter((id): id is string => !!id))];
  if (userIds.length === 0) return rows;

  switch (subject) {
    case "organization": {
      const orgIdByUserId = await resolveOrgIdsForUsers(supabase, userIds);
      const orgIds = [...new Set(orgIdByUserId.values())];
      if (orgIds.length === 0) return rows;

      const { data: orgs } = await supabase.from("organizations").select("*").in("id", orgIds);
      const orgById = new Map((orgs ?? []).map((o) => [o.id, o]));
      for (const [userId, orgId] of orgIdByUserId) {
        const org = orgById.get(orgId);
        if (org) rows.set(userId, org);
      }
      return rows;
    }

    case "person": {
      const { data: profiles } = await supabase.from("profiles").select("*").in("id", userIds);
      for (const profile of profiles ?? []) rows.set(profile.id, profile);
      return rows;
    }

    case "event_registration": {
      if (!referenceId) return rows;
      const { data: registrations } = await supabase
        .from("event_registrations")
        .select("*")
        .in("user_id", userIds)
        .eq("event_id", referenceId);
      for (const registration of registrations ?? []) {
        if (registration.user_id) rows.set(registration.user_id, registration);
      }
      return rows;
    }

    case "checklist_task": {
      // referenceId = conference_checklist_tasks.id. Completion is a
      // computed fact about each recipient's ORG (via the same CHECKS
      // registry the checklist reminder digest uses), not a stored
      // column — so this returns a synthetic single-field row rather
      // than a real table row, keeping the rest of the evaluate
      // pipeline (which just reads row[field]) unchanged.
      if (!referenceId) return rows;
      const { data: task } = await supabase
        .from("conference_checklist_tasks")
        .select("check_type, check_entity_id, checklist:conference_checklists(conference_id)")
        .eq("id", referenceId)
        .maybeSingle();
      if (!task) return rows;
      const checklist = Array.isArray(task.checklist) ? task.checklist[0] : task.checklist;
      if (!checklist) return rows;

      const orgIdByUserId = await resolveOrgIdsForUsers(supabase, userIds);
      const orgIds = [...new Set(orgIdByUserId.values())];
      // One completion check per distinct org, not per recipient — many
      // recipients share the same org.
      const completeByOrgId = new Map(
        await Promise.all(
          orgIds.map(
            async (orgId) =>
              [
                orgId,
                await evaluateChecklistTaskCheck(
                  supabase,
                  task.check_type as CheckType,
                  orgId,
                  checklist.conference_id,
                  task.check_entity_id
                ),
              ] as const
          )
        )
      );
      for (const [userId, orgId] of orgIdByUserId) {
        const isComplete = completeByOrgId.get(orgId);
        if (isComplete !== undefined) rows.set(userId, { is_complete: isComplete });
      }
      return rows;
    }

    case "conference_entity_ownership": {
      // referenceId = conference_instances.id. owns_booth/owns_registration
      // are both computed off the same referenced conference in one query —
      // a synthetic row, same precedent as checklist_task's is_complete.
      if (!referenceId) return rows;
      const orgIdByUserId = await resolveOrgIdsForUsers(supabase, userIds);
      const orgIds = [...new Set(orgIdByUserId.values())];
      if (orgIds.length === 0) return rows;

      // entity_balances is org-scoped (mint_v3_for_order always writes the
      // purchasing org's id) — kind-level ownership, not a specific booth
      // or registration tier, is what a "have they bought anything of this
      // kind yet" suppression gate actually needs.
      const { data: balances } = await supabase
        .from("entity_balances")
        .select("organization_id, conference_entities!inner(kind)")
        .in("organization_id", orgIds)
        .eq("conference_id", referenceId)
        .gt("quantity", 0);

      const ownedKindsByOrgId = new Map<string, Set<string>>();
      for (const balance of balances ?? []) {
        const entity = Array.isArray(balance.conference_entities)
          ? balance.conference_entities[0]
          : balance.conference_entities;
        if (!entity?.kind || !balance.organization_id) continue;
        const ownedKinds = ownedKindsByOrgId.get(balance.organization_id) ?? new Set<string>();
        ownedKinds.add(entity.kind);
        ownedKindsByOrgId.set(balance.organization_id, ownedKinds);
      }

      for (const [userId, orgId] of orgIdByUserId) {
        const ownedKinds = ownedKindsByOrgId.get(orgId) ?? new Set<string>();
        rows.set(userId, { owns_booth: ownedKinds.has("booth"), owns_registration: ownedKinds.has("registration") });
      }
      return rows;
    }

    default:
      return rows;
  }
}
