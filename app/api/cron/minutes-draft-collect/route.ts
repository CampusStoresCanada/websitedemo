/**
 * GET /api/cron/minutes-draft-collect
 *
 * Every five minutes. Polls in-flight minutes-drafting batches and stores any
 * that have finished, then has Butler DM whoever asked for it.
 *
 * Both calls here are fast — the long work happens inside Anthropic's batch
 * queue, which is the entire reason drafting was moved off the request path.
 */
import { NextRequest, NextResponse } from "next/server";
import { collectFinishedDrafts } from "@/lib/board/minutes-batch";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await collectFinishedDrafts();
  return NextResponse.json({ ok: true, ...result });
}
