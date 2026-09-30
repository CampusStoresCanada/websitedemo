/**
 * Who hears about a flag depends on what was flagged.
 *
 * ⛔ Plain module, deliberately. It lived in flag-notify.ts, which reaches
 * lib/email/send.ts, which constructs a Resend client at module scope and
 * throws without an API key — so a test importing this rule could not load at
 * all. lib/benchmarking/notify.ts already documents the same trap and dodges it
 * with a dynamic import; a pure rule should just not be in that file.
 */

/**
 * Raised from inside the survey rather than from a page about a store.
 *
 * Everywhere else a flag means "this page says something wrong about you", so
 * the store that owns the page is exactly who should hear it. Inside the survey
 * it is the reverse: the store is the one reporting, and routing by
 * organization_id would mail their complaint back to themselves and tell CSC
 * nothing.
 *
 * The admin pages under /benchmarking/admin are CSC's own and route normally.
 */
export function isBenchmarkingSurveyFlag(pageUrl: string): boolean {
  return /\/benchmarking\/(survey|worksheet|compare)/.test(pageUrl);
}
