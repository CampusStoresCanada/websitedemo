import { NextRequest, NextResponse } from "next/server";
import { getServerAuthState } from "@/lib/auth/server";
import { getCircleClient } from "@/lib/circle/client";

export const maxDuration = 60;

type Operation =
  | { type: "delete"; id: number }
  | { type: "rename"; id: number; name: string };

export async function POST(request: NextRequest) {
  const auth = await getServerAuthState();
  if (!auth.user || auth.globalRole !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const client = getCircleClient();
  if (!client) {
    return NextResponse.json({ error: "Circle not configured" }, { status: 503 });
  }

  const body = await request.json() as { operations: Operation[] };
  const ops: Operation[] = body.operations ?? [];

  const results: { op: Operation; ok: boolean; error?: string }[] = [];

  for (const op of ops) {
    try {
      if (op.type === "delete") {
        await client.deleteAccessGroup(op.id);
        results.push({ op, ok: true });
      } else if (op.type === "rename") {
        await client.updateAccessGroup(op.id, { name: op.name });
        results.push({ op, ok: true });
      }
    } catch (err) {
      results.push({ op, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  return NextResponse.json({ succeeded, failed, results });
}

export async function GET() {
  const auth = await getServerAuthState();
  if (!auth.user || auth.globalRole !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const client = getCircleClient();
  if (!client) {
    return NextResponse.json({ error: "Circle not configured" }, { status: 503 });
  }

  const groups = await client.listAccessGroups();
  return NextResponse.json({ groups });
}
