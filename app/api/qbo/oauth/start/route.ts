import { NextResponse } from "next/server";

// Dev-only route — generates the Intuit authorization URL and redirects.
// Visit http://localhost:3000/api/qbo/oauth/start to kick off the flow.

export const dynamic = "force-dynamic";

const REDIRECT_URI = "http://localhost:3000/api/qbo/oauth/callback";
const SCOPE = "com.intuit.quickbooks.accounting";
const AUTH_BASE = "https://appcenter.intuit.com/connect/oauth2";

export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not available in production" }, { status: 403 });
  }

  const clientId = process.env.QUICKBOOKS_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "QUICKBOOKS_CLIENT_ID not set" }, { status: 500 });
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPE,
    state: "qbo-dev-setup",
  });

  return NextResponse.redirect(`${AUTH_BASE}?${params.toString()}`);
}
