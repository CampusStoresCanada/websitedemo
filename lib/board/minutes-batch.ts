/**
 * Submit and collect board-minutes drafting jobs via the Anthropic Batch API.
 *
 * WHY BATCH, NOT A QUEUE: drafting from a full board transcript is a
 * multi-minute model call. Holding that open in a serverless function risks the
 * platform timeout, and moving it to a cron worker does not help — that worker
 * is the same kind of function with the same ceiling. The Batch API is the only
 * shape that genuinely removes the limit: Anthropic holds the work, and both of
 * our calls (submit, collect) are fast. It is also billed at half rate.
 *
 * Measured 2026-08-28: a trivial batch request took ~75s end to end, so expect
 * roughly a minute of queue overhead on top of the work itself. That is the
 * cost of never timing out, and for a monthly task it is the right trade.
 *
 * See docs/BOARD_MINUTES_DRAFT_FROM_TRANSCRIPT.md.
 */

import Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildMinutesDraftRequest } from "@/lib/board/minutes-draft";
import { announceMinutesDraftReady } from "@/lib/board/minutes-notify";

export type SubmitResult =
  | { ok: true; batchId: string; transcriptChars: number }
  | { ok: false; reason: string };

/**
 * Queue a drafting job for one meeting.
 *
 * Idempotent by construction: `board_minutes_drafts.meeting_id` is unique, so a
 * second press cannot create a second job. An existing job in flight is
 * reported rather than replaced.
 */
export async function submitMinutesDraft(
  meetingId: string,
  requestedBy: string | null
): Promise<SubmitResult> {
  const db = createAdminClient();

  const { data: existing } = await db
    .from("board_minutes_drafts")
    .select("id, status")
    .eq("meeting_id", meetingId)
    .maybeSingle();

  if (existing && existing.status === "submitted") {
    return { ok: false, reason: "A draft is already being prepared for this meeting." };
  }
  if (existing && existing.status === "ready") {
    return { ok: false, reason: "A finished draft is already waiting — load it instead of drafting again." };
  }

  // Assembled before anything is written, so a meeting that cannot be drafted
  // (no transcript, no agenda, minutes already present) never leaves a job row.
  const built = await buildMinutesDraftRequest(meetingId);
  if (!built.ok) return { ok: false, reason: built.reason };

  let batchId: string;
  try {
    const client = new Anthropic();
    const batch = await client.messages.batches.create({
      requests: [
        {
          custom_id: `minutes-${meetingId}`,
          params: built.request.params as never,
        },
      ],
    });
    batchId = batch.id;
  } catch (err) {
    console.error("[minutes-batch] submit failed", err);
    return { ok: false, reason: `Could not submit the drafting job: ${err instanceof Error ? err.message : "unknown error"}` };
  }

  // Upsert rather than insert: a previous `failed` or `consumed` row for this
  // meeting is replaced, which is what makes a retry work.
  const { error } = await db.from("board_minutes_drafts").upsert(
    {
      meeting_id: meetingId,
      batch_id: batchId,
      status: "submitted",
      data_json: null,
      error: null,
      requested_by: requestedBy,
      created_at: new Date().toISOString(),
      completed_at: null,
      consumed_at: null,
    },
    { onConflict: "meeting_id" }
  );

  if (error) {
    // The job is running at Anthropic but nothing points at it. Say so plainly
    // rather than reporting success — the batch will simply expire unread.
    console.error("[minutes-batch] could not record the job", error);
    return { ok: false, reason: `The job was submitted but could not be recorded (${error.message}). It will expire unused.` };
  }

  return { ok: true, batchId, transcriptChars: built.request.transcriptChars };
}

export interface CollectResult {
  checked: number;
  ready: number;
  failed: number;
}

/**
 * Poll every in-flight job and store any finished result.
 *
 * Stores `data_json` unrendered — HTML is produced when a human loads the
 * draft, so a change to the renderer reaches drafts already waiting.
 */
export async function collectFinishedDrafts(): Promise<CollectResult> {
  const db = createAdminClient();
  const result: CollectResult = { checked: 0, ready: 0, failed: 0 };

  const { data: jobs } = await db
    .from("board_minutes_drafts")
    .select("id, meeting_id, batch_id")
    .eq("status", "submitted");

  if (!jobs?.length) return result;

  const client = new Anthropic();

  for (const job of jobs) {
    result.checked++;
    const batchId = job.batch_id as string | null;
    if (!batchId) continue;

    try {
      const batch = await client.messages.batches.retrieve(batchId);
      if (batch.processing_status !== "ended") continue;

      let stored = false;
      for await (const entry of await client.messages.batches.results(batchId)) {
        if (entry.result.type !== "succeeded") {
          await db
            .from("board_minutes_drafts")
            .update({
              status: "failed",
              error: `Batch result: ${entry.result.type}`,
              completed_at: new Date().toISOString(),
            })
            .eq("id", job.id as string);
          result.failed++;
          stored = true;
          break;
        }

        const message = entry.result.message;
        const block = message.content.find((b) => b.type === "text");
        const raw = block && "text" in block ? block.text : "";

        let parsed: unknown = null;
        try {
          parsed = JSON.parse(raw);
        } catch {
          /* handled below */
        }

        if (!parsed) {
          await db
            .from("board_minutes_drafts")
            .update({
              status: "failed",
              error: "The draft did not come back as valid JSON.",
              completed_at: new Date().toISOString(),
            })
            .eq("id", job.id as string);
          result.failed++;
          stored = true;
          break;
        }

        await db
          .from("board_minutes_drafts")
          .update({
            status: "ready",
            data_json: parsed as never,
            error: null,
            completed_at: new Date().toISOString(),
          })
          .eq("id", job.id as string);
        result.ready++;
        stored = true;

        // Butler reports it the same way he reports a recap draft — the person
        // who asked for this has gone off to do something else.
        await announceMinutesDraftReady(job.meeting_id as string);
        break;
      }

      if (!stored) {
        await db
          .from("board_minutes_drafts")
          .update({
            status: "failed",
            error: "The batch ended with no result for this meeting.",
            completed_at: new Date().toISOString(),
          })
          .eq("id", job.id as string);
        result.failed++;
      }
    } catch (err) {
      console.error("[minutes-batch] collect failed for", batchId, err);
    }
  }

  return result;
}
