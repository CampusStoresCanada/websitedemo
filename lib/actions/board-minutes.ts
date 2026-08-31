"use server";

/**
 * Request and load background minutes drafts.
 *
 * Neither action writes minutes. `loadMinutesDraft` returns HTML to the editor
 * unsaved; the person reads it, edits, and presses Save, which runs the
 * existing PATCH route — mention rewriting, recap-tag consumption, Butler's
 * recap draft, the DM. One write path for minutes, whether they were typed,
 * pasted, or drafted here.
 *
 * See docs/BOARD_MINUTES_DRAFT_FROM_TRANSCRIPT.md §5.
 */

import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { submitMinutesDraft } from "@/lib/board/minutes-batch";
import { renderMinutesHtml } from "@/lib/board/minutes-render";
import type { MinutesData } from "@/lib/board/minutes-schema";

export interface RequestDraftResponse {
  ok: boolean;
  message?: string;
  error?: string;
}

export async function requestMinutesDraft(meetingId: string): Promise<RequestDraftResponse> {
  const auth = await requireAdmin();
  if (!auth.ok) return { ok: false, error: "Forbidden" };

  const submitted = await submitMinutesDraft(meetingId, auth.ctx.userId ?? null);
  if (!submitted.ok) return { ok: false, error: submitted.reason };

  // The DM address is stored now because it cannot be recovered later —
  // profiles carries no email and contacts.profile_id is not unique.
  const db = createAdminClient();
  await db
    .from("board_minutes_drafts")
    .update({ requested_by_email: auth.ctx.userEmail })
    .eq("meeting_id", meetingId);

  revalidatePath(`/admin/board/meetings/${meetingId}`);

  return {
    ok: true,
    message:
      `Drafting ${Math.round(submitted.transcriptChars / 1000)}k characters of transcript. ` +
      `This runs in the background — Butler will DM you when it's ready, usually within a few minutes.`,
  };
}

export interface LoadDraftResponse {
  ok: boolean;
  html?: string;
  /** The model's own judgment calls — the first thing a reviewer should read. */
  assumptions?: string[];
  error?: string;
}

/**
 * Render a finished draft into HTML for the editor.
 *
 * Deliberately does NOT mark the job consumed. Loading and then navigating away
 * without saving is an ordinary thing to do, and consuming the row here would
 * mean paying for a second drafting run to recover from it. The row stays until
 * the meeting has saved minutes, at which point the button no longer shows.
 */
export async function loadMinutesDraft(meetingId: string): Promise<LoadDraftResponse> {
  const auth = await requireAdmin();
  if (!auth.ok) return { ok: false, error: "Forbidden" };

  const db = createAdminClient();
  const { data: job } = await db
    .from("board_minutes_drafts")
    .select("status, data_json, error")
    .eq("meeting_id", meetingId)
    .maybeSingle();

  if (!job) return { ok: false, error: "There is no draft for this meeting." };
  if (job.status === "submitted") return { ok: false, error: "That draft is still being prepared." };
  if (job.status === "failed") return { ok: false, error: job.error ?? "That draft failed." };
  if (!job.data_json) return { ok: false, error: "That draft has no content." };

  try {
    const data = job.data_json as unknown as MinutesData;
    return { ok: true, html: renderMinutesHtml(data), assumptions: data.assumptions ?? [] };
  } catch (err) {
    console.error("[board-minutes] render failed", err);
    return {
      ok: false,
      error: `The draft could not be rendered: ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }
}
