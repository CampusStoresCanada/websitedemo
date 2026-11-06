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

/**
 * Something someone needs from CSC at a conference — "Ask CSC" on their own
 * page, or an ask a staff member typed into the War Room. Both are filed
 * against the conference's War Room, where they are kept and resolved.
 *
 * Same reversal as the survey: the asker's organization is who is ASKING, so
 * routing by organization_id would send a delegate's question to their own
 * store's admins. It goes to CSC staff (Stephen, 2026-10-22).
 */
export function isConferenceAskFlag(pageUrl: string): boolean {
  return /^\/admin\/conference\/[^/?#]+\/war-room(?:[?#]|$)/.test(pageUrl);
}

/**
 * The survey field a toolkit selector points at.
 *
 * ⛔ Lives here, not beside the queue loader that uses it, for the reason
 * written at the top of this file: lib/actions/benchmarking-flags.ts now
 * reaches flag-notify.ts and therefore lib/email/send.ts, which builds a Resend
 * client at module scope and throws without an API key. Anything exported from
 * there cannot be imported by a test. I put this function in that file first and
 * hit precisely that error.
 *
 * The survey renders each field as `id="field-<name>"` (DynamicSurveySection),
 * so when the member flagged a field the name is recoverable. When they flagged
 * a section or a label the toolkit falls back to a positional path like
 * `div:nth-child(2) > ...`, which identifies nothing durable: one inserted div
 * and it points somewhere else. That returns null rather than a guess.
 */
export function fieldKeyFromSelector(selector: string | null): string | null {
  const m = selector?.match(/^#field-([A-Za-z0-9_]+)$/);
  return m ? m[1] : null;
}
