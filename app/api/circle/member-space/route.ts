import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/auth/guards";
import { isCircleConfigured } from "@/lib/circle/config";
import { mintMemberToken } from "@/lib/circle/headless-auth";
import { getIntegrationConfig } from "@/lib/policy/engine";
import { resolveUserCircleId } from "@/lib/circle/member-link";
import { isFeatureEnabled } from "@/lib/data";

export const dynamic = "force-dynamic";

function toAbsoluteUrl(target: string, request: NextRequest): URL {
  if (target.startsWith("http://") || target.startsWith("https://")) {
    return new URL(target);
  }
  return new URL(target, request.url);
}

/**
 * Where inside Circle to land after the session cookie is set, from the
 * caller's ?to= (e.g. "/c/announcements-f3687d/some-post" in a campaign
 * CTA). Anything that isn't a plain path on Circle's own host is dropped
 * rather than rejected — a bad destination should still get the member
 * into Circle, just at the root.
 *
 * This is an open-redirect surface sitting directly behind an
 * authenticated token mint, so the check is allow-list shaped: exactly one
 * leading slash and nothing that can be re-parsed into a host.
 */
export function sanitizeDestination(raw: string | null): string | null {
  if (!raw) return null;
  // "//evil.com" is protocol-relative and "https://evil.com" is absolute;
  // both must fail. Requiring a single leading slash rejects each.
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  // Browsers normalize backslashes to forward slashes, so "/\evil.com"
  // becomes "//evil.com" once redirected.
  if (raw.includes("\\")) return null;
  // Control characters (raw or percent-encoded CR/LF) would split the
  // Location header.
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null;
  if (/%0[ad]/i.test(raw)) return null;
  return raw;
}

function renderTemplate(template: string, token: string, destination: string | null): string {
  let url = template.replace("{token}", encodeURIComponent(token));
  if (url.includes("{redirect}")) {
    url = url.replace("{redirect}", destination ? encodeURIComponent(destination) : "");
  }
  return url;
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
      return NextResponse.redirect(
        toAbsoluteUrl(renderTemplate(headlessTemplate, token.access_token, destination), request)
      );
    }

    // No headless template configured — no cookie exchange, so a
    // destination can't survive the hop. Land on the member space root.
    const memberSpaceUrl = process.env.CIRCLE_MEMBER_SPACE_URL ?? legacyUrl;
    return NextResponse.redirect(toAbsoluteUrl(memberSpaceUrl, request));
  } catch {
    if (legacyFallbackEnabled) {
      return NextResponse.redirect(toAbsoluteUrl(legacyUrl, request));
    }
    return NextResponse.json({ error: "Failed to create Circle member session." }, { status: 503 });
  }
}
