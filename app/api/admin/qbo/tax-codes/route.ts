import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { fetchQBTaxCodes } from "@/lib/quickbooks/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 403 });

  try {
    const taxCodes = await fetchQBTaxCodes();
    return NextResponse.json(taxCodes);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch QB tax codes" },
      { status: 500 }
    );
  }
}
