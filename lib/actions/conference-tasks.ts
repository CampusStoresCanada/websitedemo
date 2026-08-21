"use server";

import { revalidatePath } from "next/cache";
import { canManageOrganization, isGlobalAdmin, requireAuthenticated } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordOrgTaskAnswer, recordPersonalTaskAnswer } from "@/lib/conference/checklist-tasks";

type Result = { success: true } | { success: false; error: string };

/**
 * One person's answer to one of their own tasks.
 *
 * Authorised as the person themselves, someone who manages their org, or a
 * global admin — the same three-way test resolvePersonObligations uses, so a
 * partner's admin can tick things off on behalf of staff who never log in.
 */
export async function answerPersonalTask(input: {
  personId: string;
  taskId: string;
  state: "done" | "not_applicable";
  evidence?: string | null;
  revalidate?: string;
}): Promise<Result> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const { data: person } = await db
    .from("conference_people")
    .select("id, user_id, organization_id, conference_id")
    .eq("id", input.personId)
    .maybeSingle();
  if (!person) return { success: false, error: "Person not found." };
  if (!person.organization_id || !person.conference_id) {
    return { success: false, error: "This registration isn't attached to an organization yet." };
  }

  const isOwner = person.user_id === auth.ctx.userId;
  const managesOrg = canManageOrganization(auth.ctx, person.organization_id);
  if (!isOwner && !managesOrg && !isGlobalAdmin(auth.ctx.globalRole)) {
    return { success: false, error: "Not authorized to answer for this person." };
  }

  const result = await recordPersonalTaskAnswer(db, {
    conferenceId: person.conference_id,
    taskId: input.taskId,
    personId: person.id,
    organizationId: person.organization_id,
    state: input.state,
    evidence: input.evidence,
    userId: auth.ctx.userId,
  });
  if (result.success && input.revalidate) revalidatePath(input.revalidate);
  return result;
}

/** The company's answer to one of its tasks. Org managers and admins only. */
export async function answerOrgTask(input: {
  organizationId: string;
  conferenceId: string;
  taskId: string;
  state: "done" | "not_applicable";
  evidence?: string | null;
  revalidate?: string;
}): Promise<Result> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  if (!canManageOrganization(auth.ctx, input.organizationId) && !isGlobalAdmin(auth.ctx.globalRole)) {
    return { success: false, error: "Only an organization admin can answer for the company." };
  }

  const result = await recordOrgTaskAnswer(createAdminClient(), {
    conferenceId: input.conferenceId,
    taskId: input.taskId,
    organizationId: input.organizationId,
    state: input.state,
    evidence: input.evidence,
    userId: auth.ctx.userId,
  });
  if (result.success && input.revalidate) revalidatePath(input.revalidate);
  return result;
}
