import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/auth/guards";
import { isCircleConfigured } from "@/lib/circle/config";
import { mintMemberToken } from "@/lib/circle/headless-auth";
import { getIntegrationConfig } from "@/lib/policy/engine";
import { resolveUserCircleId } from "@/lib/circle/member-link";
import { isFeatureEnabled } from "@/lib/data";
import {
  communityOriginFromTemplate,
  renderBridgeInterstitial,
  sanitizeDestination,
} from "@/lib/circle/destination";

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
  // Preserve ?to= across the login bounce, so an emailed deep link still
  // lands on the right post for someone who wasn't signed in yet.
  const destination = sanitizeDestination(request.nextUrl.searchParams.get("to"));
  const selfPath = destination
    ? `/api/circle/member-space?to=${encodeURIComponent(destination)}`
    : "/api/circle/member-space";
  const loginRedirect = `/login?next=${encodeURIComponent(selfPath)}`;

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

  if (!cutoverEnabled || !isCircleConfigured() || !(await isFeatureEnabled("circle"))) {
    return NextResponse.redirect(toAbsoluteUrl(legacyUrl, request));
  }

  try {
    const circleId = await resolveUserCircleId(auth.ctx.userId, auth.ctx.userEmail);
    if (!circleId) {
      if (legacyFallbackEnabled) {
        return NextResponse.redirect(toAbsoluteUrl(legacyUrl, request));
      }
      return NextResponse.json({ error: "Account is not linked to Circle." }, { status: 400 });
    }

    const token = await mintMemberToken({ email: auth.ctx.userEmail ?? undefined });

    const headlessTemplate = process.env.CIRCLE_MEMBER_SPACE_HEADLESS_URL_TEMPLATE;
    if (headlessTemplate && headlessTemplate.includes("{token}")) {
      const exchangeUrl = withToken(headlessTemplate, token.access_token);
      const communityOrigin = communityOriginFromTemplate(headlessTemplate);

      // No destination asked for (the Header "Member Space" link, notification
      // hrefs): redirect straight through, same as it has always behaved. The
      // interstitial is only worth a render when it has somewhere to go.
      if (!destination || !communityOrigin) {
        return NextResponse.redirect(toAbsoluteUrl(exchangeUrl, request));
      }

      return new NextResponse(
        renderBridgeInterstitial(exchangeUrl, `${communityOrigin}${destination}`),
        {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            // The body carries a member access token.
            "Cache-Control": "no-store, no-cache, must-revalidate",
            "X-Robots-Tag": "noindex, nofollow",
            "Referrer-Policy": "no-referrer",
          },
        }
      );
    }

    // No headless template configured — no cookie exchange, so a destination
    // can't survive the hop. Land on the member space root.
    const memberSpaceUrl = process.env.CIRCLE_MEMBER_SPACE_URL ?? legacyUrl;
    return NextResponse.redirect(toAbsoluteUrl(memberSpaceUrl, request));
  } catch {
    if (legacyFallbackEnabled) {
      return NextResponse.redirect(toAbsoluteUrl(legacyUrl, request));
    }
    return NextResponse.json({ error: "Failed to create Circle member session." }, { status: 503 });
  }
}
