"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticated, isGlobalAdmin } from "@/lib/auth/guards";
import {
  notifyLeadOfPendingNote,
  notifyStoreOfPendingNote,
  notifyAuthorOfOutcome,
} from "@/lib/benchmarking/note-notifications";
import { DEFAULT_FIELD_CONFIG } from "@/lib/benchmarking/default-field-config";

/** Human label for a field, so a DM doesn't say "total_gross_sales_instore". */
function fieldLabel(fieldName: string): string {
  for (const section of DEFAULT_FIELD_CONFIG.sections) {
    const match = section.fields.find((f) => f.name === fieldName);
    if (match) return match.label;
  }
  return fieldName;
}

async function storeName(organizationId: string): Promise<string> {
  const db = createAdminClient();
  const { data } = await db
    .from("organizations")
    .select("name")
    .eq("id", organizationId)
    .maybeSingle();
  return data?.name ?? "a member store";
}

/**
 * The explanation chain.
 *
 *   reviewer writes  →  secretary_review
 *   secretary yes    →  respondent_review
 *   secretary no     →  private
 *   respondent yes   →  published
 *   respondent no    →  private
 *   respondent quiet →  stays private, unless the secretary overrides
 *
 * Silence never publishes on its own. An override is recorded as an override,
 * so a note is never mistaken for one the store agreed to.
 */

type Actor = { ok: boolean; userId?: string; error?: string };

async function actor(): Promise<Actor> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { ok: false, error: "Not signed in" };
  return { ok: true, userId: auth.ctx.userId };
}

async function secretaryOrAdmin(): Promise<Actor> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { ok: false, error: "Not signed in" };
  const allowed =
    isGlobalAdmin(auth.ctx.globalRole) ||
    auth.ctx.capabilities.includes("benchmarking.committee_lead");
  if (!allowed) return { ok: false, error: "Committee lead access required" };
  return { ok: true, userId: auth.ctx.userId };
}


/**
 * Consent seal: Nothing about a sealed year may change — not the note, not the
 * approval, not the store's answer.
 *
 * Checked in every action rather than once at a chokepoint, because there is no
 * chokepoint: five separate entry points can alter what a published figure says
 * about a store, and one of them forgetting is the same as none of them
 * checking.
 */
async function sealBlockForSurvey(surveyId: string): Promise<string | null> {
  const db = createAdminClient();
  const { data } = await db
    .from("benchmarking_surveys")
    .select("fiscal_year")
    .eq("id", surveyId)
    .maybeSingle();
  if (!data?.fiscal_year) return null;

  const { isYearSealed, sealMessage } = await import("@/lib/benchmarking/seal");
  const state = await isYearSealed(data.fiscal_year as number);
  return state.sealed ? sealMessage(state) : null;
}

async function sealBlockForNote(noteId: string): Promise<string | null> {
  const db = createAdminClient();
  const { data } = await db
    .from("benchmarking_notes")
    .select("survey_id")
    .eq("id", noteId)
    .maybeSingle();
  if (!data?.survey_id) return null;
  return sealBlockForSurvey(data.survey_id as string);
}

/**
 * A reviewer explains why a figure is unusual but correct.
 *
 * Often written after a follow-up call rather than at the moment of review, so
 * this can be called against a flag that has been sitting in follow-up.
 */
export async function writeNote(input: {
  surveyId: string;
  organizationId: string;
  fieldName: string;
  note: string;
  deltaFlagId?: string | null;
  /** Leave false to keep drafting; true sends it to the Secretary. */
  submit?: boolean;
}): Promise<{ success: boolean; noteId?: string; error?: string }> {
  const me = await actor();
  if (!me.ok || !me.userId) return { success: false, error: me.error };

  const text = input.note?.trim();
  if (!text) return { success: false, error: "Write the explanation first" };

  const sealed = await sealBlockForSurvey(input.surveyId);
  if (sealed) return { success: false, error: sealed };

  const db = createAdminClient();
  const { data, error } = await db
    .from("benchmarking_notes")
    .insert({
      survey_id: input.surveyId,
      organization_id: input.organizationId,
      field_name: input.fieldName,
      delta_flag_id: input.deltaFlagId ?? null,
      note: text,
      author_id: me.userId,
      status: input.submit ? "secretary_review" : "draft",
    })
    .select("id")
    .single();

  if (error) {
    console.error("[benchmarking-notes] writeNote failed:", error);
    return { success: false, error: "Could not save the explanation" };
  }

  if (input.submit) {
    const [name, { data: me2 }] = await Promise.all([
      storeName(input.organizationId),
      db
        .from("profiles")
        .select("display_name")
        .eq("id", me.userId)
        .maybeSingle(),
    ]);
    // Best-effort: a failed DM must not undo a saved explanation.
    void notifyLeadOfPendingNote({
      storeName: name,
      fieldLabel: fieldLabel(input.fieldName),
      authorName: me2?.display_name ?? null,
    }).catch(() => {});
  }

  revalidatePath("/benchmarking/admin/flags");
  return { success: true, noteId: data.id };
}

export async function updateNote(
  noteId: string,
  note: string,
): Promise<{ success: boolean; error?: string }> {
  const me = await actor();
  if (!me.ok || !me.userId) return { success: false, error: me.error };

  const sealed = await sealBlockForNote(noteId);
  if (sealed) return { success: false, error: sealed };

  const text = note?.trim();
  if (!text) return { success: false, error: "The explanation can't be empty" };

  const db = createAdminClient();
  // Only while it is still the author's to change.
  const { error } = await db
    .from("benchmarking_notes")
    .update({ note: text })
    .eq("id", noteId)
    .eq("author_id", me.userId)
    .in("status", ["draft", "secretary_review"]);

  if (error) {
    console.error("[benchmarking-notes] updateNote failed:", error);
    return { success: false, error: "Could not update" };
  }
  revalidatePath("/benchmarking/admin/flags");
  return { success: true };
}

/** The Secretary decides whether this goes to the store at all. */
export async function secretaryDecide(
  noteId: string,
  decision: "approved" | "declined",
): Promise<{ success: boolean; error?: string }> {
  const me = await secretaryOrAdmin();
  if (!me.ok || !me.userId) return { success: false, error: me.error };

  const sealed = await sealBlockForNote(noteId);
  if (sealed) return { success: false, error: sealed };

  const db = createAdminClient();
  const { error } = await db
    .from("benchmarking_notes")
    .update({
      secretary_decision: decision,
      secretary_id: me.userId,
      secretary_at: new Date().toISOString(),
      status: decision === "approved" ? "respondent_review" : "private",
    })
    .eq("id", noteId)
    .eq("status", "secretary_review");

  if (error) {
    console.error("[benchmarking-notes] secretaryDecide failed:", error);
    return { success: false, error: "Could not record the decision" };
  }

  const { data: row } = await db
    .from("benchmarking_notes")
    .select("organization_id, field_name, author_id")
    .eq("id", noteId)
    .maybeSingle();

  if (row) {
    if (decision === "approved") {
      void notifyStoreOfPendingNote({
        organizationId: row.organization_id,
        fieldLabel: fieldLabel(row.field_name),
      }).catch(() => {});
    } else {
      void notifyAuthorOfOutcome({
        authorId: row.author_id,
        storeName: await storeName(row.organization_id),
        fieldLabel: fieldLabel(row.field_name),
        outcome: "private",
      }).catch(() => {});
    }
  }

  revalidatePath("/benchmarking/admin/notes");
  revalidatePath("/benchmarking/survey");
  return { success: true };
}

/**
 * The store says whether it is happy for this to be said about its number.
 * Only someone in that organization can answer.
 */
export async function respondentDecide(
  noteId: string,
  decision: "agreed" | "objected",
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: "Not signed in" };

  const sealed = await sealBlockForNote(noteId);
  if (sealed) return { success: false, error: sealed };
  const { userId, activeOrgIds } = auth.ctx;

  const db = createAdminClient();
  const { data: note } = await db
    .from("benchmarking_notes")
    .select("id, organization_id, status")
    .eq("id", noteId)
    .maybeSingle();

  if (!note) return { success: false, error: "Not found" };
  if (!activeOrgIds.includes(note.organization_id)) {
    return { success: false, error: "That isn't your store" };
  }
  if (note.status !== "respondent_review") {
    return { success: false, error: "This isn't waiting on you" };
  }

  const { error } = await db
    .from("benchmarking_notes")
    .update({
      respondent_decision: decision,
      respondent_id: userId,
      respondent_at: new Date().toISOString(),
      status: decision === "agreed" ? "published" : "private",
    })
    .eq("id", noteId);

  if (error) {
    console.error("[benchmarking-notes] respondentDecide failed:", error);
    return { success: false, error: "Could not save your answer" };
  }

  const { data: full } = await db
    .from("benchmarking_notes")
    .select("author_id, field_name, organization_id")
    .eq("id", noteId)
    .maybeSingle();

  if (full) {
    void notifyAuthorOfOutcome({
      authorId: full.author_id,
      storeName: await storeName(full.organization_id),
      fieldLabel: fieldLabel(full.field_name),
      outcome: decision === "agreed" ? "published" : "private",
    }).catch(() => {});
  }

  revalidatePath("/benchmarking/survey");
  revalidatePath("/benchmarking/admin/notes");
  return { success: true };
}

/**
 * Publish over a store that never answered.
 *
 * Deliberately separate from the ordinary path, and deliberately recorded: the
 * note carries published_on_override so it is never mistaken for one the store
 * agreed to. A reason is required — it is the thing anyone asks for later.
 */
export async function overridePublish(
  noteId: string,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  const me = await secretaryOrAdmin();
  if (!me.ok || !me.userId) return { success: false, error: me.error };

  const sealed = await sealBlockForNote(noteId);
  if (sealed) return { success: false, error: sealed };

  const why = reason?.trim();
  if (!why) {
    return { success: false, error: "Say why you're publishing without them" };
  }

  const db = createAdminClient();
  const { error } = await db
    .from("benchmarking_notes")
    .update({
      status: "published",
      published_on_override: true,
      override_by: me.userId,
      override_at: new Date().toISOString(),
      override_reason: why,
    })
    .eq("id", noteId)
    .eq("status", "respondent_review")
    .is("respondent_decision", null);

  if (error) {
    console.error("[benchmarking-notes] overridePublish failed:", error);
    return { success: false, error: "Could not publish" };
  }

  revalidatePath("/benchmarking/admin/notes");
  return { success: true };
}
