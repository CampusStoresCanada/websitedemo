"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEventSafe } from "@/lib/ops/audit";
import { validateRuleInput, type SpaceRuleInput } from "@/lib/circle/space-rules";

type Result = { success: true } | { success: false; error: string };

/**
 * Add a rule (id null) or change one. The space of an existing rule is fixed:
 * the job's add/remove ledger is keyed by space, so moving a rule would strand
 * everyone it added to the old space.
 */
export async function saveCircleSpaceRule(id: string | null, input: SpaceRuleInput): Promise<Result> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const checked = validateRuleInput(input);
  if (!checked.ok) return { success: false, error: checked.error };

  const db = createAdminClient();
  // The last run's numbers described the old criteria; clear them until the next run.
  const fields = { ...checked.row, last_run: null, last_run_at: null, updated_at: new Date().toISOString() };

  if (id) {
    // ⚠️ The DESTINATION of an existing rule is fixed, not just its space. The
    // job's add/remove ledger is keyed to where the rule points, so moving a
    // rule would strand everyone it had already put in the old place — and
    // that is as true of a Google group as of a Circle space.
    //
    // Destructured rather than deleted from a Partial: `fields` is a union of
    // the per-kind row shapes, and Partial-of-a-union stopped being assignable
    // once space_id became nullable.
    const {
      space_id: _fixedSpace,
      google_group_email: _fixedGroup,
      destination: _fixedDestination,
      ...update
    } = fields;
    const { error } = await db.from("circle_space_rules").update(update).eq("id", id);
    if (error) return { success: false, error: error.message };
  } else {
    const { error } = await db.from("circle_space_rules").insert({ ...fields, created_by: auth.ctx.userId });
    if (error) {
      if (error.code === "23505")
        return {
          success: false,
          // One rule per destination, whichever kind of destination it is.
          error:
            checked.row.destination === "google_group"
              ? "That Google group already has a rule. Edit it instead."
              : "That space already has a rule. Edit it instead.",
        };
      return { success: false, error: error.message };
    }
  }

  await logAuditEventSafe({
    action: id ? "circle_space_rule_updated" : "circle_space_rule_created",
    entityType: "circle_space_rule",
    entityId: id ?? undefined,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: { ...checked.row },
  });
  revalidatePath("/admin/circle/spaces");
  return { success: true };
}

/** Stop syncing a space. Nobody is removed: people already in it stay. */
export async function deleteCircleSpaceRule(id: string): Promise<Result> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const { data, error } = await db
    .from("circle_space_rules")
    .delete()
    .eq("id", id)
    .select("space_id, label, kind, conference_id, pass_entity_ids, survey_field, survey_value");
  if (error) return { success: false, error: error.message };

  await logAuditEventSafe({
    action: "circle_space_rule_deleted",
    entityType: "circle_space_rule",
    entityId: id,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: { removed: data?.[0] ?? null },
  });
  revalidatePath("/admin/circle/spaces");
  return { success: true };
}
