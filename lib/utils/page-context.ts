/**
 * Detects what kind of page a URL pathname represents.
 * Pure client/server utility — no async, no DB access.
 */

export type PageContext =
  | { type: "org"; slug: string }
  | { type: "event"; slug: string }
  | { type: "members_directory" }
  | { type: "partners_directory" }
  | { type: "unknown" };

export function detectPageContext(pathname: string): PageContext {
  const orgMatch = pathname.match(/^\/(?:members|org)\/([^/?#]+)/);
  if (orgMatch) return { type: "org", slug: orgMatch[1] };

  const eventMatch = pathname.match(/^\/events\/([^/?#]+)/);
  if (eventMatch) return { type: "event", slug: eventMatch[1] };

  if (pathname === "/members" || pathname.startsWith("/members?")) return { type: "members_directory" };
  if (pathname === "/partners" || pathname.startsWith("/partners?")) return { type: "partners_directory" };

  return { type: "unknown" };
}
