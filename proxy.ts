import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { getCurrentConferencePath } from "@/lib/conference/current";
import {
  REQUEST_PATHNAME_HEADER,
  REQUEST_SEARCH_HEADER,
  needsRequestPathStamp,
} from "@/lib/auth/request-path";

const EVENTS_DOMAIN_HOSTS = new Set(["campusstores.events", "www.campusstores.events"]);
const CANONICAL_ORIGIN = "https://www.campusstores.ca";

export async function proxy(request: NextRequest) {
  const host = request.headers.get("host")?.toLowerCase() ?? "";

  // campusstores.events is a second domain pointed at this same deployment
  // (Vercel) purely as a friendly, always-current entry point — it's not a
  // separate site. Every request on it redirects to the live conference on
  // the real domain; nothing about campusstores.ca's own routes changes, so
  // every existing link into /conference/... keeps working exactly as-is.
  if (EVENTS_DOMAIN_HOSTS.has(host)) {
    const path = await getCurrentConferencePath();
    const response = NextResponse.redirect(new URL(path ?? "/", CANONICAL_ORIGIN), 307);
    response.headers.set("Cache-Control", "public, max-age=300");
    return response;
  }

  /*
    Carry the requested path into the areas gated in a layout.

    ⛔ A layout gate fires before the page's own guard, and Next tells a layout
    nothing about the child path. So a signed-out visitor to /admin/renewals got
    sent to the admin dashboard, and the exact loginWithNext("/admin/renewals")
    that page makes for itself never ran. This is the only way those gates can
    name where someone was going.

    Which areas, and why they are a list rather than the whole site: see
    LAYOUT_GATED_PREFIXES. This proxy already runs on every request for the
    Supabase session refresh, so the stamp is scoped rather than the matcher.
    Setting rather than appending also means a client that sends its own
    x-csc-pathname has it overwritten on exactly the paths that trust it.
  */
  const { pathname, search } = request.nextUrl;

  return await updateSession(
    request,
    needsRequestPathStamp(pathname)
      ? {
          [REQUEST_PATHNAME_HEADER]: pathname,
          [REQUEST_SEARCH_HEADER]: search,
        }
      : undefined,
  );
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder static assets
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
