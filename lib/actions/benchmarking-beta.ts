"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticated, isGlobalAdmin } from "@/lib/auth/guards";
import { hasCapability } from "@/lib/auth/capabilities";
import { CAPABILITIES } from "@/lib/auth/capability-names";
import { RETIRED_FIELDS } from "@/lib/benchmarking/retired-fields";
import { FIELD_REGISTRY } from "@/lib/benchmarking/field-registry";
import { RESET_PHRASE } from "@/lib/benchmarking/beta-reset";

/**
 * Wiping a beta tester's own submission so they can attack it again.
 *
 * A beta tester's answers count: they file a real submission, not a sandbox
 * copy. That is what makes their testing worth anything, and it is also what
 * makes this button dangerous, so it asks them to type the word.
 *
 * ⛔ The submission only. Locations, key dates, contacts, logos, services and
 * the procurement buyer list belong to the ORGANISATION and outlive any one
 * year — several of them are shared with the directory and the conference. A
 * store wiping its survey to try again must not lose its people.
 */

/**
 * Answers whose column refuses NULL, with the value the schema defaults them to.
 *
 * Keep this in step with any `not null` column that carries an answer. There is
 * exactly one today, and the wipe fails loudly in testing if another appears.
 */
const RESET_TO_DEFAULT: Record<string, unknown> = {
  student_wages_is_contribution: true,
};

type Guard =
  | { ok: true; organizationId: string; fiscalYear: number; actorId: string }
  | { ok: false; error: string };

async function guardBeta(benchmarkingId: string): Promise<Guard> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { ok: false, error: auth.error };

  const db = createAdminClient();
  const { data: row } = await db
    .from("benchmarking")
    .select("organization_id, fiscal_year")
    .eq("id", benchmarkingId)
    .maybeSingle();
  if (!row) return { ok: false, error: "That submission does not exist." };

  const organizationId = row.organization_id as string;
  const fiscalYear = row.fiscal_year as number;

  /*
    Two things have to be true, and an admin gets no shortcut past the second.

    Global admins can reach every store's survey through the org switcher, so
    an admin-only check would put a "wipe this store's answers" button on all
    52. Whoever presses this must be a beta tester AND be at their own store.
  */
  const isBeta = await hasCapability(
    auth.ctx.userId,
    CAPABILITIES.BENCHMARKING_BETA_TESTER,
  );
  if (!isBeta) {
    return { ok: false, error: "Only appointed beta testers can wipe a submission." };
  }

  const { data: link } = await db
    .from("user_organizations")
    .select("role")
    .eq("user_id", auth.ctx.userId)
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .maybeSingle();

  if (!link && !isGlobalAdmin(auth.ctx.globalRole)) {
    return { ok: false, error: "That is not your store." };
  }

  return { ok: true, organizationId, fiscalYear, actorId: auth.ctx.userId };
}

export async function resetBetaSubmission(input: {
  benchmarkingId: string;
  confirmation: string;
}): Promise<{ success: boolean; error?: string; cleared?: number }> {
  const g = await guardBeta(input.benchmarkingId);
  if (!g.ok) return { success: false, error: g.error };

  if (input.confirmation.trim().toUpperCase() !== RESET_PHRASE) {
    return { success: false, error: `Type ${RESET_PHRASE} to confirm.` };
  }

  const db = createAdminClient();

  /*
    Every answerable column back to null, read from the registry rather than
    listed here. A hand-written list is a list that goes stale the first time
    somebody adds a question, and the failure would be silent: the wipe would
    quietly leave the newest answers behind.
  */
  const patch: Record<string, unknown> = {};
  for (const name of Object.keys(FIELD_REGISTRY)) {
    if (RETIRED_FIELDS.has(name)) continue;
    /*
      ⛔ A NOT NULL answer resets to its default, not to null.

      Nulling every registry field wholesale meant one NOT NULL column rejected
      the entire UPDATE, so the wipe silently did nothing at all and reported
      "could not wipe the answers". tsc, the tests and the build were all green:
      only pressing the button found it.
    */
    patch[name] = RESET_TO_DEFAULT[name] ?? null;
  }

  // Back to a fresh draft, keeping only what identifies the row.
  patch.status = "draft";
  patch.submitted_at = null;
  patch.reviewed_at = null;
  patch.verified_at = null;
  patch.verified_by = null;
  patch.updated_at = new Date().toISOString();

  const { error } = await db
    .from("benchmarking")
    .update(patch)
    .eq("id", input.benchmarkingId);
  if (error) {
    console.error("[beta] reset failed:", error);
    return { success: false, error: "Could not wipe the answers." };
  }

  /*
    The rows the store built, which are answers too.

    ⛔ benchmarking_locations is NOT here. Locations carry square footage and
    opening hours that the store maintains year to year, and the metrics divide
    by them. Wiping a survey should not cost a store its floor plan.
  */
  const childTables = [
    "benchmarking_category_lines",
    "benchmarking_categories",
    "benchmarking_other_income",
    "benchmarking_other_expenses",
    "benchmarking_staff",
    "benchmarking_competitors",
  ] as const;

  // Lines hang off categories, so they go first.
  const { data: categoryIds } = await db
    .from("benchmarking_categories")
    .select("id")
    .eq("benchmarking_id", input.benchmarkingId);

  if ((categoryIds ?? []).length > 0) {
    await db
      .from("benchmarking_category_lines")
      .delete()
      .in("category_id", (categoryIds ?? []).map((c) => c.id as string));
  }

  let cleared = 0;
  for (const table of childTables) {
    if (table === "benchmarking_category_lines") continue;
    const { count } = await db
      .from(table)
      .delete({ count: "exact" })
      .eq("benchmarking_id", input.benchmarkingId);
    cleared += count ?? 0;
  }

  /*
    Said out loud in the record. A wiped submission looks identical to one
    nobody ever started, and when a beta tester reports that their figures
    vanished, the difference is the only thing worth knowing.
  */
  await db.from("audit_log").insert({
    action: "benchmarking.beta_reset",
    entity_type: "benchmarking",
    entity_id: input.benchmarkingId,
    actor_id: g.actorId,
    actor_type: "user",
    details: {
      fiscal_year: g.fiscalYear,
      organization_id: g.organizationId,
      child_rows_cleared: cleared,
      note: "Beta tester wiped their own answers. Organisation-level data (locations, key dates, contacts, logos) untouched.",
    },
  });

  return { success: true, cleared };
}
