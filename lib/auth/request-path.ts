import { loginWithNext } from "@/lib/auth/login-redirect";

/**
 * The path a request actually asked for, carried from the proxy to a layout.
 *
 * ⛔ Next does not pass the pathname to a layout, and a layout gate therefore
 * cannot name the page the visitor wanted. `app/admin/layout.tsx` gates every
 * `/admin/*` page and fires before the page's own guard, so a signed-out
 * visitor to /admin/renewals used to land on the admin dashboard, and the
 * exact `loginWithNext` call that page makes for itself was dead code.
 *
 * proxy.ts stamps these two headers on the way in. They are set, never
 * appended, so a client that sends its own copy has it overwritten on exactly
 * the paths that read it.
 */
/**
 * The areas whose gate lives in a layout, and therefore the only paths the
 * stamp is set on.
 *
 * ⛔ Adding an area here is the whole change — there is no second mechanism to
 * build. Scoping this to /admin alone is what left the Circle flag DM
 * ("Read it and answer: .../benchmarking/admin/issues", lib/circle/flag-notify.ts)
 * dropping its own destination: the layout sent everyone to /benchmarking/admin,
 * and a recipient without the capability was then bounced on to /benchmarking,
 * which reads as "login threw my link away".
 */
export const LAYOUT_GATED_PREFIXES = ["/admin", "/benchmarking/admin"] as const;

/** True for a request whose gate cannot name its own path without the stamp. */
export function needsRequestPathStamp(pathname: string): boolean {
  return LAYOUT_GATED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export const REQUEST_PATHNAME_HEADER = "x-csc-pathname";
export const REQUEST_SEARCH_HEADER = "x-csc-search";

/**
 * Rebuild a query record from a raw `?a=1&a=2` string without collapsing
 * repeats, because `loginWithNext` keeps every value of a repeated param and
 * `Object.fromEntries` would silently keep only the last one.
 */
function toQueryRecord(search: string): Record<string, string | string[]> {
  const params = new URLSearchParams(search);
  const query: Record<string, string | string[]> = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    query[key] = values.length > 1 ? values : values[0];
  }
  return query;
}

/**
 * The `/login?next=...` destination for a gate that only knows the request
 * through its headers.
 *
 * Takes a `Headers` rather than calling `headers()` itself so that proxy.ts can
 * import the header names from this module without pulling `next/headers` into
 * the proxy bundle, and so this stays unit-testable.
 *
 * `fallback` is used whenever the stamp is missing or not a plain relative
 * path, which is what a request that bypassed the proxy matcher looks like.
 */
export function loginPathFromHeaders(headerList: Headers, fallback: string): string {
  const pathname = headerList.get(REQUEST_PATHNAME_HEADER);

  // Same rule loginWithNext applies to its own input: relative, and not
  // protocol-relative. A stamp that fails it is treated as absent.
  if (!pathname || !pathname.startsWith("/") || pathname.startsWith("//")) {
    return loginWithNext(fallback);
  }

  const search = headerList.get(REQUEST_SEARCH_HEADER) ?? "";
  return loginWithNext(pathname, search ? toQueryRecord(search) : undefined);
}
