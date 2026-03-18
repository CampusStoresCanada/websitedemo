import { NextRequest, NextResponse } from "next/server";

// Dev-only route — receives the OAuth2 callback from Intuit, exchanges the
// authorization code for tokens, and displays the refresh token on screen.

export const dynamic = "force-dynamic";

const REDIRECT_URI = "http://localhost:3000/api/qbo/oauth/callback";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not available in production" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const realmId = searchParams.get("realmId");
  const error = searchParams.get("error");

  if (error) {
    return new NextResponse(errorPage(error), { headers: { "Content-Type": "text/html" } });
  }

  if (!code) {
    return NextResponse.json({ error: "No authorization code in callback" }, { status: 400 });
  }

  const clientId = process.env.QUICKBOOKS_CLIENT_ID;
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "QB credentials not configured" }, { status: 500 });
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
    }).toString(),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    return new NextResponse(errorPage(`Token exchange failed (${tokenRes.status}): ${body}`), {
      headers: { "Content-Type": "text/html" },
    });
  }

  const tokens = await tokenRes.json();

  return new NextResponse(successPage(tokens.refresh_token, tokens.access_token, realmId), {
    headers: { "Content-Type": "text/html" },
  });
}

function successPage(refreshToken: string, accessToken: string, realmId: string | null) {
  return `<!DOCTYPE html>
<html>
<head><title>QB OAuth Success</title>
<style>
  body { font-family: monospace; padding: 2rem; background: #f0fdf4; }
  h1 { color: #166534; }
  .box { background: white; border: 1px solid #bbf7d0; border-radius: 8px; padding: 1.5rem; margin: 1rem 0; }
  label { font-weight: bold; display: block; margin-bottom: 0.25rem; color: #15803d; }
  .token { word-break: break-all; background: #f9fafb; padding: 0.75rem; border-radius: 4px; border: 1px solid #e5e7eb; }
  .note { color: #6b7280; font-size: 0.85rem; margin-top: 0.5rem; }
</style>
</head>
<body>
<h1>QuickBooks OAuth — Success</h1>
<p>Add these to your <code>.env.local</code>:</p>

<div class="box">
  <label>QUICKBOOKS_REFRESH_TOKEN=</label>
  <div class="token">${refreshToken}</div>
  <p class="note">Valid for 101 days. Re-run this flow when it expires.</p>
</div>

${realmId ? `<div class="box">
  <label>QUICKBOOKS_REALM_ID=</label>
  <div class="token">${realmId}</div>
  <p class="note">Your sandbox Company ID — add this if not already set.</p>
</div>` : ""}

<div class="box">
  <label>Access Token (expires in 1 hour — do not store)</label>
  <div class="token">${accessToken}</div>
</div>

<p class="note">This page is only accessible in development (NODE_ENV=development).</p>
</body>
</html>`;
}

function errorPage(message: string) {
  return `<!DOCTYPE html>
<html>
<head><title>QB OAuth Error</title>
<style>
  body { font-family: monospace; padding: 2rem; background: #fef2f2; }
  h1 { color: #991b1b; }
  .box { background: white; border: 1px solid #fecaca; border-radius: 8px; padding: 1.5rem; }
</style>
</head>
<body>
<h1>QuickBooks OAuth — Error</h1>
<div class="box">${message}</div>
</body>
</html>`;
}
