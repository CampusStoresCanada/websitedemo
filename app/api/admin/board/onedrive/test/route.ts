/**
 * GET /api/admin/board/onedrive/test
 *
 * Diagnostic endpoint — super admin only.
 * Tests each step of the Graph API auth chain and reports what passes/fails.
 * Remove or gate behind a feature flag before shipping to production.
 */

import { NextResponse } from "next/server";
import { requireAdmin, isSuperAdmin } from "@/lib/auth/guards";

export const runtime = "nodejs";

const TOKEN_URL = (tenantId: string) =>
  `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok || !isSuperAdmin(auth.ctx.globalRole)) {
    return NextResponse.json({ error: "Super admin required" }, { status: 403 });
  }

  const report: Record<string, unknown> = {};

  // ── 1. Env var presence ──────────────────────────────────────────
  const tenantId     = process.env.CSC_BOARD_PORTAL_DIRECTORY;
  const clientId     = process.env.CSC_BOARD_PORTAL_APPLICATION;
  const clientSecret = process.env.CSC_BOARD_PORTAL_VALUE;

  report.env = {
    CSC_BOARD_PORTAL_DIRECTORY:    tenantId   ? `set (${tenantId.slice(0, 8)}…)`   : "MISSING",
    CSC_BOARD_PORTAL_APPLICATION:  clientId   ? `set (${clientId.slice(0, 8)}…)`   : "MISSING",
    CSC_BOARD_PORTAL_VALUE:        clientSecret
      ? `set (length=${clientSecret.length}, starts=${clientSecret.slice(0, 4)}…)`
      : "MISSING",
    CSC_BOARD_PORTAL_EXPIRY: process.env.CSC_BOARD_PORTAL_EXPIRY ?? "not set",
  };

  if (!tenantId || !clientId || !clientSecret) {
    return NextResponse.json({ ok: false, step: "env", report });
  }

  // ── 2. Token fetch ───────────────────────────────────────────────
  let accessToken: string | null = null;
  try {
    const tokenRes = await fetch(TOKEN_URL(tenantId), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type:    "client_credentials",
        client_id:     clientId,
        client_secret: clientSecret,
        scope:         "https://graph.microsoft.com/.default",
      }),
    });

    const tokenBody = await tokenRes.json() as Record<string, unknown>;

    if (!tokenRes.ok) {
      report.tokenFetch = {
        ok:     false,
        status: tokenRes.status,
        body:   tokenBody,
      };
      return NextResponse.json({ ok: false, step: "token_fetch", report });
    }

    accessToken = tokenBody.access_token as string;

    // Decode JWT claims (middle segment) without verifying signature
    // — just for diagnostics, to see what roles/scopes the token actually contains
    const parts = accessToken.split(".");
    if (parts.length === 3) {
      try {
        const claims = JSON.parse(
          Buffer.from(parts[1], "base64url").toString("utf-8")
        ) as Record<string, unknown>;
        report.tokenClaims = {
          appid:    claims.appid,
          tid:      claims.tid,
          roles:    claims.roles,        // application permissions granted
          scp:      claims.scp,          // delegated scopes (should be absent here)
          aud:      claims.aud,
          exp:      claims.exp,
          iss:      claims.iss,
        };
      } catch {
        report.tokenClaims = "Could not decode JWT";
      }
    }

    report.tokenFetch = {
      ok:         true,
      expiresIn:  tokenBody.expires_in,
      tokenType:  tokenBody.token_type,
    };
  } catch (err) {
    report.tokenFetch = { ok: false, error: String(err) };
    return NextResponse.json({ ok: false, step: "token_fetch", report });
  }

  // ── 3. Basic Graph call — /organization (no Files permission needed) ──
  try {
    const orgRes = await fetch("https://graph.microsoft.com/v1.0/organization", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const orgBody = await orgRes.json() as Record<string, unknown>;
    report.graphOrg = {
      ok:     orgRes.ok,
      status: orgRes.status,
      value:  orgRes.ok
        ? (orgBody.value as Array<{displayName: string; id: string}>)?.map((o) => ({
            id: o.id,
            displayName: o.displayName,
          }))
        : orgBody,
    };
  } catch (err) {
    report.graphOrg = { ok: false, error: String(err) };
  }

  // ── 4. User drive call ────────────────────────────────────────────
  // Try to list root site drives (low permission) to see if Files.Read.All is consented
  try {
    const driveRes = await fetch(
      "https://graph.microsoft.com/v1.0/sites/root/drives",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const driveBody = await driveRes.json() as Record<string, unknown>;
    report.graphDrives = {
      ok:     driveRes.ok,
      status: driveRes.status,
      count:  driveRes.ok ? (driveBody.value as unknown[])?.length : undefined,
      error:  driveRes.ok ? undefined : driveBody,
    };
  } catch (err) {
    report.graphDrives = { ok: false, error: String(err) };
  }

  return NextResponse.json({ ok: true, report });
}
