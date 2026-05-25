import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { cookies } from "next/headers";

const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const APP_SETTINGS_KEY = "qbo_refresh_token";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return NextResponse.redirect(new URL("/admin/board/financials?qbo_error=forbidden", req.url));
  }

  const { searchParams } = req.nextUrl;
  const code    = searchParams.get("code");
  const state   = searchParams.get("state");
  const realmId = searchParams.get("realmId");
  const error   = searchParams.get("error");

  // User cancelled or Intuit returned an error
  if (error) {
    return NextResponse.redirect(
      new URL(`/admin/board/financials?qbo_error=${encodeURIComponent(error)}`, req.url),
    );
  }

  if (!code || !state || !realmId) {
    return NextResponse.redirect(
      new URL("/admin/board/financials?qbo_error=missing_params", req.url),
    );
  }

  // Verify CSRF state
  const cookieStore = await cookies();
  const savedState = cookieStore.get("qbo_oauth_state")?.value;
  cookieStore.delete("qbo_oauth_state");

  if (!savedState || savedState !== state) {
    return NextResponse.redirect(
      new URL("/admin/board/financials?qbo_error=state_mismatch", req.url),
    );
  }

  const clientId     = process.env.QUICKBOOKS_CLIENT_ID;
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(
      new URL("/admin/board/financials?qbo_error=missing_credentials", req.url),
    );
  }

  // Exchange authorization code for tokens
  const redirectUri = `${req.nextUrl.origin}/api/admin/qbo/oauth/callback`;
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization:  `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept:         "application/json",
    },
    body: new URLSearchParams({
      grant_type:   "authorization_code",
      code,
      redirect_uri: redirectUri,
    }).toString(),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    console.error("[QBO OAuth callback] token exchange failed:", body);
    return NextResponse.redirect(
      new URL(`/admin/board/financials?qbo_error=token_exchange_failed`, req.url),
    );
  }

  const tokens = await tokenRes.json();
  const refreshToken = tokens.refresh_token;

  if (!refreshToken) {
    return NextResponse.redirect(
      new URL("/admin/board/financials?qbo_error=no_refresh_token", req.url),
    );
  }

  // Persist refresh token and realm ID to app_settings
  const db = createAdminClient();
  await Promise.all([
    db.from("app_settings").upsert(
      { key: APP_SETTINGS_KEY, value: refreshToken },
      { onConflict: "key" },
    ),
    // Store realm ID in case it wasn't set via env
    db.from("app_settings").upsert(
      { key: "qbo_realm_id", value: realmId },
      { onConflict: "key" },
    ),
  ]);

  console.log(`[QBO OAuth] Successfully connected. Realm ID: ${realmId}`);

  return NextResponse.redirect(
    new URL("/admin/board/financials?qbo_connected=true", req.url),
  );
}
