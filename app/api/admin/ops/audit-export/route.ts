import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

type AuditRow = {
  id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  actor_id: string | null;
  actor_type: string;
  created_at: string;
  details: unknown;
};

function csvCell(value: unknown): string {
  const raw = typeof value === "string" ? value : value == null ? "" : JSON.stringify(value);
  const escaped = raw.replace(/"/g, '""');
  return `"${escaped}"`;
}

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const url = new URL(request.url);
  const action = (url.searchParams.get("action") ?? "").trim().toLowerCase();
  const actor = (url.searchParams.get("actor") ?? "").trim().toLowerCase();
  const entityType = (url.searchParams.get("entityType") ?? "").trim().toLowerCase();
  const entityId = (url.searchParams.get("entityId") ?? "").trim().toLowerCase();
  const from = (url.searchParams.get("from") ?? "").trim();
  const to = (url.searchParams.get("to") ?? "").trim();
  const requestedLimit = Number(url.searchParams.get("limit") ?? "1000");
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(5000, Math.max(1, Math.floor(requestedLimit)))
    : 1000;

  const db = createAdminClient() as unknown as {
    from: (table: string) => {
      select: (columns: string) => {
        order: (column: string, opts?: { ascending?: boolean }) => {
          limit: (limit: number) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
        };
      };
    };
  };

  const { data, error } = await db
    .from("audit_log")
    .select("id, action, entity_type, entity_id, actor_id, actor_type, details, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: `Failed to load audit rows: ${error.message}` }, { status: 500 });
  }

  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;

  const rows = ((data ?? []) as AuditRow[]).filter((row) => {
    const actionOk = action ? row.action.toLowerCase().includes(action) : true;
    const actorOk = actor ? (row.actor_id ?? "").toLowerCase().includes(actor) : true;
    const entityTypeOk = entityType
      ? (row.entity_type ?? "").toLowerCase().includes(entityType)
      : true;
    const entityIdOk = entityId
      ? (row.entity_id ?? "").toLowerCase().includes(entityId)
      : true;
    const createdAt = new Date(row.created_at);
    const fromOk = fromDate ? createdAt >= fromDate : true;
    const toOk = toDate ? createdAt <= toDate : true;
    return actionOk && actorOk && entityTypeOk && entityIdOk && fromOk && toOk;
  });

  const header = [
    "id",
    "created_at",
    "action",
    "entity_type",
    "entity_id",
    "actor_type",
    "actor_id",
    "details",
  ];

  const body = rows.map((row) =>
    [
      row.id,
      row.created_at,
      row.action,
      row.entity_type,
      row.entity_id,
      row.actor_type,
      row.actor_id,
      row.details,
    ]
      .map(csvCell)
      .join(",")
  );

  const csv = [header.join(","), ...body].join("\n");

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename=\"audit-log-${new Date().toISOString().slice(0, 10)}.csv\"`,
      "cache-control": "no-store",
    },
  });
}
