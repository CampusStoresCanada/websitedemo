import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { fetchQBItems } from "@/lib/quickbooks/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 403 });

  try {
    const items = await fetchQBItems();
    return NextResponse.json(items);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch QB items" },
      { status: 500 }
    );
  }
}
