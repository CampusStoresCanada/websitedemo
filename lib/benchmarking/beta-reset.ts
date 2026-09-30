/**
 * ⛔ Plain module, not "use server".
 *
 * This lived beside resetBetaSubmission in the actions file, where a `use
 * server` module may export nothing but async functions. tsc passed, the whole
 * test suite passed, and only `next build` caught it — which is exactly what
 * CLAUDE.md says will happen, and exactly what happened.
 */

/** What a beta tester has to type to wipe their own submission. Not "yes". */
export const RESET_PHRASE = "WIPE MY ANSWERS";
