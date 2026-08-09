import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { getCurrentConferencePath } from "@/lib/conference/current";

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

  return await updateSession(request);
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
