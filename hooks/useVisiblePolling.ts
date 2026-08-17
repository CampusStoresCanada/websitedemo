"use client";

import { useEffect, useRef } from "react";

/**
 * Delay to use for the next poll. Activity returns to base cadence; a quiet
 * cycle decays toward `maxIntervalMs`. Pure — see __tests__/useVisiblePolling.
 */
export function nextPollDelay(
  currentDelay: number,
  sawActivity: boolean,
  intervalMs: number,
  maxIntervalMs: number,
  backoffFactor: number
): number {
  if (sawActivity) return intervalMs;
  return Math.min(currentDelay * backoffFactor, maxIntervalMs);
}

/**
 * Delay to re-arm with when the user shows signs of life, or `null` to leave
 * the pending timer alone.
 *
 * Guarantees, in order: no-op at base cadence (so click spam is free), never
 * pushes the next run later than it was already scheduled, and never fires
 * closer than `intervalMs` after the previous run. Pure.
 */
export function wakePollDelay(
  currentDelay: number,
  lastRunAt: number,
  nextRunAt: number,
  now: number,
  intervalMs: number
): number | null {
  if (currentDelay === intervalMs) return null;
  const earliest = lastRunAt + intervalMs;
  if (earliest >= nextRunAt) return null;
  return Math.max(earliest - now, 0);
}

export interface VisiblePollingOptions {
  /** Cadence while the user is engaged and the data is actually changing. */
  intervalMs: number;
  /**
   * Ceiling the cadence decays to while nothing is happening. Omit (or set
   * equal to intervalMs) for a fixed-rate poll.
   */
  maxIntervalMs?: number;
  /** Multiplier applied to the delay after each no-change poll. */
  backoffFactor?: number;
}

/**
 * Poll `fetcher` while the tab is visible, decaying the cadence when nothing
 * is happening.
 *
 * Upstream calls cost real money (Circle bills per API call), so this is
 * deliberately stingy on three axes:
 *
 *  1. **Visibility** — background tabs poll not at all. Most "open tab" time
 *     is a tab nobody is looking at, and it used to bill around the clock.
 *  2. **Idle backoff** — `fetcher` returns `true` when it saw something new.
 *     Consecutive no-change polls multiply the delay up to `maxIntervalMs`,
 *     so a quiet site settles into a slow trickle on its own.
 *  3. **Cheap wake-up** — real engagement (new data, tab refocus, a click or
 *     keypress) snaps the cadence back to `intervalMs`.
 *
 * Waking up only ever pulls the next run *earlier*, never later, and is a
 * no-op when already at base cadence — so leaning on the keyboard cannot
 * push polls into the future or produce a burst of requests. The floor
 * between any two runs stays `intervalMs`.
 *
 * `fetcher` receives an AbortSignal that fires on unmount, which also cancels
 * the in-flight request when the user navigates away.
 */
export function useVisiblePolling(
  fetcher: (signal: AbortSignal) => boolean | void | Promise<boolean | void>,
  options: VisiblePollingOptions,
  enabled: boolean
): void {
  const { intervalMs, maxIntervalMs = intervalMs, backoffFactor = 2 } = options;

  // Keep the latest fetcher without re-arming the timer on every render.
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    if (!enabled) return;
    if (typeof document === "undefined") return;

    const controller = new AbortController();
    let timerId: number | null = null;
    let currentDelay = intervalMs;
    let lastRunAt = 0;
    let nextRunAt = 0;
    let stopped = false;

    const clearTimer = () => {
      if (timerId === null) return;
      window.clearTimeout(timerId);
      timerId = null;
    };

    const schedule = (delay: number = currentDelay) => {
      clearTimer();
      if (stopped || document.visibilityState !== "visible") return;
      nextRunAt = Date.now() + delay;
      timerId = window.setTimeout(run, delay);
    };

    const run = async () => {
      lastRunAt = Date.now();
      let sawActivity: boolean | void = false;
      try {
        sawActivity = await fetcherRef.current(controller.signal);
      } catch {
        // The fetcher owns its own error handling; a throw just counts as a
        // quiet cycle rather than killing the poll loop.
      }
      if (stopped || controller.signal.aborted) return;
      currentDelay = nextPollDelay(
        currentDelay,
        sawActivity === true,
        intervalMs,
        maxIntervalMs,
        backoffFactor
      );
      schedule();
    };

    /**
     * Something suggests the user is engaged — return to base cadence. Only
     * ever moves the next run earlier, and never closer than intervalMs to
     * the previous one.
     */
    const wake = () => {
      const delay = wakePollDelay(currentDelay, lastRunAt, nextRunAt, Date.now(), intervalMs);
      if (delay === null) return;
      currentDelay = intervalMs;
      schedule(delay);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        currentDelay = intervalMs;
        // Coming back to a stale tab is worth one immediate refresh.
        if (Date.now() - lastRunAt >= intervalMs) void run();
        else schedule(Math.max(lastRunAt + intervalMs - Date.now(), 0));
      } else {
        clearTimer();
      }
    };

    if (document.visibilityState === "visible") {
      void run();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pointerdown", wake, { passive: true });
    window.addEventListener("keydown", wake, { passive: true });

    return () => {
      stopped = true;
      clearTimer();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
      controller.abort();
    };
  }, [enabled, intervalMs, maxIntervalMs, backoffFactor]);
}
