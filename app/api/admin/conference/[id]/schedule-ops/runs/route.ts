import { NextRequest, NextResponse } from "next/server";
import { createSchedulerDraftRun, promoteSchedulerRun } from "@/lib/actions/conference-scheduler";
import { isSuperAdmin, requireConferenceOpsAccess } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

type RunActionBody =
  | { action: "generate_draft"; seed?: number }
  | { action: "promote"; runId: string };

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireConferenceOpsAccess();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id: conferenceId } = await context.params;

  let body: RunActionBody;
  try {
    body = (await request.json()) as RunActionBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (body.action === "generate_draft") {
    const result = await createSchedulerDraftRun(conferenceId, body.seed);
    if (!result.success) {
      return NextResponse.json(
        { error: result.error, code: result.code ?? null, dependency: result.dependency ?? null },
        { status: 400 }
      );
    }
    return NextResponse.json(result.data);
  }

  if (body.action === "promote") {
    if (!isSuperAdmin(auth.ctx.globalRole)) {
      return NextResponse.json(
        { error: "Only super_admin can promote scheduler runs." },
        { status: 403 }
      );
    }
    if (!body.runId) {
      return NextResponse.json({ error: "runId is required for promote action." }, { status: 400 });
    }
    const result = await promoteSchedulerRun(conferenceId, body.runId);
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json(result.data);
  }

  return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
}
