import { NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/auth/guards";
import { logAuditEventSafe } from "@/lib/ops/audit";

type AuthTelemetryEvent =
  | "auth_idle_timeout"
  | "auth_bootstrap_recovery_failed"
  | "auth_login_redirect_loop";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      event?: AuthTelemetryEvent;
      details?: Record<string, unknown>;
    };

    const event = body.event;
    if (
      event !== "auth_idle_timeout" &&
      event !== "auth_bootstrap_recovery_failed" &&
      event !== "auth_login_redirect_loop"
    ) {
      return NextResponse.json({ error: "Invalid event." }, { status: 400 });
    }

    const auth = await requireAuthenticated();
    const actorId = auth.ok ? auth.ctx.userId : null;

    await logAuditEventSafe({
      action: event,
      entityType: "auth_session",
      actorId,
      actorType: actorId ? "user" : "system",
      details: body.details ?? {},
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to record auth telemetry." },
      { status: 500 }
    );
  }
}
