import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/auth/guards";
import { isCircleConfigured } from "@/lib/circle/config";
import { mintMemberToken } from "@/lib/circle/headless-auth";
import { getIntegrationConfig } from "@/lib/policy/engine";
import { resolveUserCircleId } from "@/lib/circle/member-link";

export const dynamic = "force-dynamic";

function toAbsoluteUrl(target: string, request: NextRequest): URL {
  if (target.startsWith("http://") || target.startsWith("https://")) {
    return new URL(target);
  }
  return new URL(target, request.url);
}

function withToken(template: string, token: string): string {
  return template.replace("{token}", encodeURIComponent(token));
}

export async function GET(request: NextRequest) {
  const loginRedirect = `/login?next=${encodeURIComponent("/api/circle/member-space")}`;

  const auth = await requireAuthenticated();
  if (!auth.ok) {
    return NextResponse.redirect(toAbsoluteUrl(loginRedirect, request));
  }

  const legacyUrl =
    process.env.CIRCLE_LEGACY_MEMBER_SPACE_URL ??
    process.env.CIRCLE_MEMBER_SPACE_URL ??
    "https://app.circle.so";

  let cutoverEnabled = false;
  let legacyFallbackEnabled = true;

  try {
    const config = await getIntegrationConfig();
    cutoverEnabled = Boolean(config.circle_cutover_enabled);
    legacyFallbackEnabled = Boolean(config.circle_legacy_fallback_enabled);
  } catch {
    cutoverEnabled = false;
    legacyFallbackEnabled = true;
  }

  if (!cutoverEnabled || !isCircleConfigured()) {
    return NextResponse.redirect(toAbsoluteUrl(legacyUrl, request));
  }

  try {
    const circleId = await resolveUserCircleId(auth.ctx.userId);
    if (!circleId) {
      if (legacyFallbackEnabled) {
        return NextResponse.redirect(toAbsoluteUrl(legacyUrl, request));
      }
      return NextResponse.json({ error: "Account is not linked to Circle." }, { status: 400 });
    }

    const token = await mintMemberToken({ community_member_id: circleId });

    const headlessTemplate = process.env.CIRCLE_MEMBER_SPACE_HEADLESS_URL_TEMPLATE;
    if (headlessTemplate && headlessTemplate.includes("{token}")) {
      return NextResponse.redirect(toAbsoluteUrl(withToken(headlessTemplate, token.access_token), request));
    }

    const memberSpaceUrl = process.env.CIRCLE_MEMBER_SPACE_URL ?? legacyUrl;
    return NextResponse.redirect(toAbsoluteUrl(memberSpaceUrl, request));
  } catch {
    if (legacyFallbackEnabled) {
      return NextResponse.redirect(toAbsoluteUrl(legacyUrl, request));
    }
    return NextResponse.json({ error: "Failed to create Circle member session." }, { status: 503 });
  }
}
