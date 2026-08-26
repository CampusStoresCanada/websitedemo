/**
 * Pure helpers for duplicate-organization matching.
 *
 * Split out of lib/actions/applications.ts because that file is "use server",
 * where every export must be an async server action — so nothing in it can be
 * unit tested directly. The matching rules are exactly the part worth testing.
 */

/**
 * A real registrable domain: labels separated by dots, with a TLD of at least
 * two letters. Deliberately strict, because the result is fed to a substring
 * `ilike` — see extractDomain.
 */
const DOMAIN_RE =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/;

/**
 * Domain of an email address or URL, or null if the input isn't one.
 *
 * The null case is the important one. Applicants type things like "N/A" into
 * the website field, and the naive parse turned "https://N/A" into the single
 * character "n" — which then ran as `website ilike '%n%'` and matched almost
 * every organization with a website. A real submission surfaced ~100 "possible
 * duplicates", several flagged as already having paid invoices, burying the one
 * true match. Anything that isn't a registrable domain has to come back null so
 * the caller skips that lookup entirely rather than matching the world.
 */
export function extractDomain(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;

  const atIdx = trimmed.indexOf("@");
  const candidate =
    atIdx !== -1
      ? trimmed.slice(atIdx + 1)
      : trimmed
          .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
          .replace(/^www\./, "")
          .split(/[/?#]/)[0];

  const domain = candidate.split(":")[0].replace(/\.$/, "");
  return DOMAIN_RE.test(domain) ? domain : null;
}
