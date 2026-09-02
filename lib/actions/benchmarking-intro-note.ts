"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticated, isGlobalAdmin } from "@/lib/auth/guards";

/**
 * The committee's own words on the survey's opening page.
 *
 * A store reading that page gets four sections of CSC explaining itself. This
 * is the one part written by the person who chairs the committee reviewing
 * their figures, and it is the only part that can say why it matters this year
 * rather than in general.
 *
 * Stored in site_content under a single fixed section key. Deliberately NOT a
 * general site_content editor: this action can write exactly one row, so
 * granting the committee lead the ability to write their note does not also
 * grant them the ability to rewrite the homepage.
 *
 * Renders only when they have written something — an empty block on a trust
 * page reads worse than no block.
 */

const SECTION = "benchmarking_intro_chair";

export interface IntroNote {
  title: string | null;
  body: string | null;
}

async function guard() {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { ok: false as const, error: "Not signed in" };
  const { capabilities, globalRole } = auth.ctx;
  const allowed =
    isGlobalAdmin(globalRole) || capabilities.includes("benchmarking.committee_lead");
  if (!allowed) return { ok: false as const, error: "Not authorized" };
  return { ok: true as const, ctx: auth.ctx };
}

export async function getIntroNote(): Promise<IntroNote | null> {
  const db = createAdminClient();
  const { data } = await db
    .from("site_content")
    .select("title, body")
    .eq("section", SECTION)
    .maybeSingle();
  return data ?? null;
}

export async function saveIntroNote(input: {
  title: string;
  body: string;
}): Promise<{ success: boolean; error?: string }> {
  const g = await guard();
  if (!g.ok) return { success: false, error: g.error };

  const title = input.title.trim();
  const body = input.body.trim();

  // Empty means "take it down", not "save nothing". A chair who clears the box
  // is deciding the page reads better without them this year, and that has to
  // be expressible — otherwise the only way to remove it is to ask an admin.
  const isActive = body.length > 0;

  try {
    const db = createAdminClient();
    const { data: existing } = await db
      .from("site_content")
      .select("id")
      .eq("section", SECTION)
      .maybeSingle();

    const row = {
      section: SECTION,
      content_type: "text",
      title: title || "From the benchmarking committee",
      body: body || null,
      is_active: isActive,
      display_order: 0,
      updated_by: g.ctx.userId,
      updated_at: new Date().toISOString(),
    };

    const { error } = existing
      ? await db.from("site_content").update(row).eq("id", existing.id)
      : await db.from("site_content").insert(row);

    if (error) {
      console.error("[benchmarking-intro-note] save failed:", error);
      return { success: false, error: error.message };
    }

    // The survey intro is what changed; revalidate it rather than the console.
    revalidatePath("/benchmarking/survey");
    return { success: true };
  } catch (err) {
    console.error("[benchmarking-intro-note] failed:", err);
    return { success: false, error: err instanceof Error ? err.message : "Save failed" };
  }
}
