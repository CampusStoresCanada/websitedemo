/**
 * Run something with a deadline, and CANCEL it when the deadline passes.
 *
 * ⛔ Takes a factory, not a promise. A bare `Promise.race` stops WAITING but
 * cannot stop the work, and that distinction was expensive here: AuthProvider's
 * `fetchUserData` issues four Supabase queries, so every timed-out attempt left
 * them in flight while the retry immediately launched four more. One failure
 * could leave a dozen orphaned requests racing each other, each making the next
 * attempt slower and so likelier to time out. The retry meant to recover from
 * slowness was itself a cause of it — 3,074 timeouts against 1,316 successes in
 * the dev log, with 43% of permission refreshes exhausting all three attempts
 * and falling back to cached permissions.
 *
 * ⚠️ Races AS WELL AS aborting, deliberately. If a call ignores the signal — the
 * supabase-js auth methods accept none — the deadline must still fire, or fixing
 * a leak would trade it for a hang, which is worse.
 */
export function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  return Promise.race([
    run(controller.signal),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => {
        // ⚠️ Reject FIRST, then abort. `Promise.race` settles on whichever comes
        // first, and aborting can make the work reject with its own generic
        // AbortError — which would win, and the caller would lose the labelled
        // message. That label is how this problem was found at all; a timeout
        // reported as "aborted" is a timeout nobody can grep for.
        reject(new Error(`${label} timed out after ${ms}ms`));
        // Still cancel, so a retry starts against an idle connection instead of
        // competing with its own predecessor.
        controller.abort();
      }, ms);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}
