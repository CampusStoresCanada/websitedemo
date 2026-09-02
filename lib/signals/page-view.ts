/**
 * What a path is worth recording, and what of it.
 *
 * Pure — no request, no database — so the rules that decide whether a person's
 * movement becomes signal can be tested without either.
 *
 * ⛔ `/admin` is never recorded. Staff working the admin surface are doing their
 * job, not expressing what their store buys — the same reason the association's
 * own announcements are excluded from the match space. Steve, on his 101 Circle
 * posts: "sorta worthless. I am a functionary." An admin session is that, all
 * the way down.
 */

/** Prefixes that are never signal, whoever is signed in. */
const NEVER: readonly string[] = [
  "/admin", // staff at work — see above
  "/api", // machines, not people
  "/_next", // build output
  "/auth", // sign-in plumbing
  "/login",
  "/forgot-password",
  "/reset-password",
  "/email-preferences", // arrived by clicking an unsubscribe footer, not interest
];

/** Extensions that mean a file was served, not a page visited. */
const ASSET = /\.(?:svg|png|jpe?g|gif|webp|ico|css|js|map|woff2?|ttf|pdf|csv|xlsx?|docx?)$/i;

/**
 * Query parameters that carry meaning rather than mechanics.
 *
 * ⛔ An allow-list, not a block-list. Query strings are where tokens, emails and
 * session ids end up, and a block-list is one new parameter away from storing a
 * password reset token in a behavioural table forever. Anything not named here
 * is discarded without inspection.
 */
const MEANINGFUL_PARAMS: readonly string[] = ["q", "search", "category", "department", "province", "tag"];

/** The longest facet worth keeping — past this it is a paste, not a query. */
const MAX_FACET = 120;

export interface PathSignal {
  path: string;
  /** One allow-listed parameter's value, or null. */
  facet: string | null;
}

/**
 * Normalise a URL into what we would store, or null if it is not signal.
 *
 * Accepts a full URL or a bare path. Returns null for admin, machinery, assets
 * and anything unparseable — callers should treat null as "say nothing", never
 * as an error.
 */
export function pathSignal(url: string): PathSignal | null {
  if (!url) return null;

  // ⛔ Demand a path or an absolute http(s) URL before parsing. `new URL` with a
  // base NEVER throws on rubbish — it resolves "not a url at all" to
  // "/not%20a%20url%20at%20all" and hands back a perfectly valid-looking page
  // view. Guarding on the try/catch alone lets any string become a row.
  const isAbsolute = /^https?:\/\//i.test(url);
  if (!isAbsolute && !url.startsWith("/")) return null;

  let path: string;
  let params: URLSearchParams;
  try {
    // A relative path needs a base; the base is discarded immediately.
    const parsed = new URL(url, "https://placeholder.invalid");
    path = parsed.pathname;
    params = parsed.searchParams;
  } catch {
    return null;
  }

  // Trailing slashes make "/directory" and "/directory/" two different rows for
  // the same act. Root stays "/".
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);

  if (!path.startsWith("/")) return null;
  if (ASSET.test(path)) return null;

  // ⚠️ Prefix match must respect segment boundaries. A plain `startsWith("/api")`
  // would also silently drop a legitimate page at "/apiary" or "/apply" — and
  // "/apply" is a real route on this site.
  for (const prefix of NEVER) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return null;
  }

  let facet: string | null = null;
  for (const key of MEANINGFUL_PARAMS) {
    const value = params.get(key)?.trim();
    if (value) {
      facet = value.slice(0, MAX_FACET);
      break;
    }
  }

  return { path, facet };
}

/**
 * The text an embedder should see for one view.
 *
 * ⛔ Slugs, not ids. "/directory/merangue" carries the partner's name and embeds
 * to something about that partner; "/directory/8f3c-…" embeds to noise that
 * happens to sit near every other uuid. A path made only of ids is dropped
 * rather than contributed as a meaningless direction.
 */
export function viewText(signal: PathSignal): string | null {
  const words = signal.path
    .split("/")
    .filter(Boolean)
    .filter((seg) => !isOpaque(seg))
    .map((seg) => seg.replace(/[-_]+/g, " ").trim())
    .filter(Boolean);

  if (words.length === 0) return null;
  const base = words.join(" ");
  return signal.facet ? `${base} ${signal.facet}` : base;
}

/** A uuid, a long hex or digit run — an identifier, carrying no meaning to embed. */
function isOpaque(segment: string): boolean {
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment) ||
    /^\d+$/.test(segment) ||
    /^[0-9a-f]{16,}$/i.test(segment)
  );
}
