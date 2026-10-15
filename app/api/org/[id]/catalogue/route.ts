import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getViewerContext } from "@/lib/visibility/viewer";

/**
 * Resolve a partner's catalogue URL for an authorized viewer.
 *
 * Why this exists: the directory and map pages are ISR-cached (revalidate =
 * 60) and shared by every viewer, so their payload cannot carry anything
 * viewer-dependent — a member's copy of the page would be served straight to
 * an anonymous visitor out of the cache. Those pages therefore carry only
 * `hasCatalogue: boolean`, and the link points here. One request per click,
 * not per page render.
 *
 * Catalogues are a partner's own sales material, aimed at member buyers.
 * Members and CSC staff get the redirect; anonymous visitors and competing
 * partners do not (partners get nothing about other partners from the cross
 * visibility rules by design — see lib/visibility/engine.ts).
 *
 * GET-only and side-effect free: this is a link target, and mail scanners
 * pre-fetch link targets, so it must never mutate anything.
 */

const ALLOWED_LEVELS = new Set(["member", "org_admin", "admin", "super_admin"]);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const viewer = await getViewerContext();

  // An org_admin of a partner org is still a partner where other orgs are
  // concerned, so authorize on the viewer level, not on holding a seat —
  // except on the partner's own page, where they may reach their own file.
  const isOwnOrg = viewer.viewerOrgIds.includes(id);

  if (!isOwnOrg && !ALLOWED_LEVELS.has(viewer.viewerLevel)) {
    const destination = viewer.userId ? "/partners" : "/login";
    return NextResponse.redirect(new URL(destination, req.nextUrl.origin));
  }

  const supabase = createAdminClient();
  const { data: org, error } = await supabase
    .from("organizations")
    .select("catalogue_url")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[org/catalogue] lookup failed:", error.message);
    return NextResponse.redirect(new URL("/partners", req.nextUrl.origin));
  }

  const url = org?.catalogue_url?.trim();
  if (!url) {
    return NextResponse.redirect(new URL("/partners", req.nextUrl.origin));
  }

  return NextResponse.redirect(url);
}
