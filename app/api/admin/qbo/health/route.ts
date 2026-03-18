import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findQBCustomer } from "@/lib/quickbooks/client";

// Dev/admin-only: verify QB connection is working
export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not available in production" }, { status: 403 });
  }

  const checks: Record<string, string> = {};

  // Check env vars
  checks.client_id = process.env.QUICKBOOKS_CLIENT_ID ? "set" : "MISSING";
  checks.client_secret = process.env.QUICKBOOKS_CLIENT_SECRET ? "set" : "MISSING";
  checks.realm_id = process.env.QUICKBOOKS_REALM_ID ? "set" : "MISSING";
  checks.refresh_token_env = process.env.QUICKBOOKS_REFRESH_TOKEN ? "set" : "MISSING";

  // Check app_settings
  try {
    const db = createAdminClient();
    const { data } = await db
      .from("app_settings")
      .select("value")
      .eq("key", "qbo_refresh_token")
      .single();
    checks.refresh_token_db = data?.value ? "set" : "empty (will seed from env on first use)";
  } catch {
    checks.refresh_token_db = "error reading app_settings";
  }

  // Try a real QB API call
  try {
    await findQBCustomer("__health_check__");
    checks.api_connection = "ok";
  } catch (err) {
    checks.api_connection = `FAILED: ${err instanceof Error ? err.message : String(err)}`;
  }

  const allOk = Object.values(checks).every(
    (v) => v === "ok" || v === "set" || v.includes("seed")
  );

  return NextResponse.json({ ok: allOk, checks });
}
