import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { fetchQBAccounts } from "@/lib/quickbooks/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 403 });

  try {
    const accounts = await fetchQBAccounts();
    return NextResponse.json(accounts);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch QB accounts" },
      { status: 500 }
    );
  }
}
