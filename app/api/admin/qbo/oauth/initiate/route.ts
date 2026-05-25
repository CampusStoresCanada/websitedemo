import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { cookies } from "next/headers";
import crypto from "crypto";

const INTUIT_AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const SCOPE = "com.intuit.quickbooks.accounting";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const clientId = process.env.QUICKBOOKS_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "QUICKBOOKS_CLIENT_ID not set" }, { status: 500 });
  }

  // CSRF state token
  const state = crypto.randomBytes(16).toString("hex");
  const cookieStore = await cookies();
  cookieStore.set("qbo_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600, // 10 minutes
    path: "/",
  });

  // Redirect URI derived from the request origin — works on localhost and Vercel
  const redirectUri = `${req.nextUrl.origin}/api/admin/qbo/oauth/callback`;

  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri,
    scope:         SCOPE,
    response_type: "code",
    state,
  });

  return NextResponse.redirect(`${INTUIT_AUTH_URL}?${params.toString()}`);
}
