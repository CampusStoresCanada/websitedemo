/**
 * Assemble the drafting request for a meeting's minutes.
 *
 * This module gathers the inputs and builds the request; it does not send it.
 * The send happens through the Batch API (`minutes-batch.ts`) because a full
 * board transcript is a multi-minute call and a serverless function should not
 * hold one open — a cron worker would be the same function with the same
 * ceiling, so moving the work to Anthropic is the only shape that actually
 * removes the timeout. It is also half price.
 *
 * The model does exactly one job — read a transcript against an agenda and
 * return `data.json` — and does not render, fetch, or write anything. Rendering
 * is deterministic (`build_html.js`), and a human reads the result before it is
 * saved.
 *
 * The drafting rules are NOT duplicated here. They are read at runtime from
 * `skills/csc-board-minutes/references/`, which is also what the CoWork skill
 * uses, so there is one copy of the judgment and it lives with the skill.
 * `SKILL.md` itself is deliberately NOT sent: it describes a human workflow
 * (fetch from Notion, run the build scripts, render a PDF, deliver the files)
 * that this caller has already done or will do itself, and a model that follows
 * instructions literally would try to act on it.
 *
 * See docs/BOARD_MINUTES_DRAFT_FROM_TRANSCRIPT.md.
 */

import fs from "node:fs";
import path from "node:path";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchMeetingTranscript } from "@/lib/board/meeting-transcript";
import { MINUTES_DATA_SCHEMA } from "@/lib/board/minutes-schema";

const SKILL_REFS = "skills/csc-board-minutes/references";

/** Read once per process — these files change with a deploy, not per request. */
let cachedContract: string | null = null;

function draftingContract(): string {
  if (cachedContract) return cachedContract;
  const read = (name: string) =>
    fs.readFileSync(path.join(process.cwd(), SKILL_REFS, name), "utf8");

  cachedContract = [
    read("drafting_contract.md"),
    "\n\n---\n\n# Output shape (data_schema.md)\n\n",
    read("data_schema.md"),
    "\n\n---\n\n# Roster and transcription corrections (board_roster.md)\n\n",
    read("board_roster.md"),
  ].join("");
  return cachedContract;
}

export interface MinutesDraftRequest {
  /** Messages-API params, ready to submit synchronously or as a batch item. */
  params: Record<string, unknown>;
  transcriptChars: number;
}

export type BuildDraftResult =
  | { ok: true; request: MinutesDraftRequest }
  | { ok: false; reason: string };

/**
 * The directory used for Present/Absent reconstruction.
 *
 * Deliberately the SAME query `rewriteMentions()` uses on minutes save. If the
 * draft names someone the mention rewriter doesn't know, the saved minutes and
 * the minted action items disagree about who that is — so both sides read one
 * list.
 */
async function boardDirectory(): Promise<string[]> {
  const db = createAdminClient();
  const { data } = await db
    .from("profiles")
    .select("display_name")
    .in("global_role", ["admin", "super_admin"]);
  return (data ?? []).map((p) => p.display_name as string).filter(Boolean).sort();
}

/**
 * Gather the inputs and build the request. Refuses early and specifically
 * rather than submitting a job that cannot succeed.
 */
export async function buildMinutesDraftRequest(meetingId: string): Promise<BuildDraftResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, reason: "ANTHROPIC_API_KEY is not configured." };
  }

  const transcript = await fetchMeetingTranscript(meetingId);
  if (!transcript.ready) return { ok: false, reason: transcript.reason };

  const db = createAdminClient();
  const { data: meeting } = await db
    .from("board_meetings")
    .select("id, title, meeting_date, agenda_html, minutes_html")
    .eq("id", meetingId)
    .maybeSingle();

  if (!meeting) return { ok: false, reason: "That meeting could not be found." };

  // Refuse rather than overwrite. Generated minutes must never replace edited
  // ones; the caller can clear them deliberately if that is really the intent.
  if ((meeting.minutes_html as string | null)?.trim()) {
    return {
      ok: false,
      reason: "This meeting already has minutes. Clear them first if you want to draft again.",
    };
  }

  const agenda = (meeting.agenda_html as string | null)?.trim();
  if (!agenda) {
    return {
      ok: false,
      reason:
        "This meeting has no agenda. The minutes are mapped onto the agenda's own numbering, so it is required.",
    };
  }

  // Continuity input: the most recent earlier meeting that actually has minutes.
  const { data: prev } = await db
    .from("board_meetings")
    .select("title, minutes_html")
    .lt("meeting_date", meeting.meeting_date as string)
    .not("minutes_html", "is", null)
    .order("meeting_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const directory = await boardDirectory();

  const userContent = [
    `# Meeting\n\n${meeting.title}  (${meeting.meeting_date})`,
    `# Current board and staff (from the association's records)\n\n${directory.join("\n")}`,
    `# Agenda for this meeting\n\n${agenda}`,
    prev?.minutes_html
      ? `# Previous meeting's minutes — for continuity only (${prev.title})\n\n${prev.minutes_html}`
      : `# Previous meeting's minutes\n\n(none available)`,
    `# Transcript\n\n${transcript.text}`,
  ].join("\n\n---\n\n");

  return {
    ok: true,
    request: {
      transcriptChars: transcript.charCount,
      params: {
        model: "claude-opus-5",
        max_tokens: 32000,
        output_config: {
          effort: "high",
          format: { type: "json_schema", schema: MINUTES_DATA_SCHEMA },
        },
        system: draftingContract(),
        messages: [{ role: "user", content: userContent }],
      },
    },
  };
}
