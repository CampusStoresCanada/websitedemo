import { describe, it, expect } from "vitest";
import { nextPollDelay, wakePollDelay } from "../useVisiblePolling";

// Header.tsx's real numbers.
const BASE = 300_000; // 5m
const MAX = 1_800_000; // 30m
const FACTOR = 2;

const decay = (d: number) => nextPollDelay(d, false, BASE, MAX, FACTOR);

describe("nextPollDelay", () => {
  it("decays 5m -> 10m -> 20m -> 30m and holds at the cap", () => {
    const seen: number[] = [];
    let d = BASE;
    for (let i = 0; i < 5; i++) {
      d = decay(d);
      seen.push(d);
    }
    expect(seen).toEqual([600_000, 1_200_000, MAX, MAX, MAX]);
  });

  it("snaps back to base cadence the moment activity is seen", () => {
    let d = BASE;
    d = decay(d);
    d = decay(d);
    d = decay(d);
    expect(d).toBe(MAX);
    expect(nextPollDelay(d, true, BASE, MAX, FACTOR)).toBe(BASE);
  });

  it("never exceeds the cap even if the cap is not a multiple of the base", () => {
    expect(nextPollDelay(MAX - 1, false, BASE, MAX, FACTOR)).toBe(MAX);
  });

  it("stays fixed-rate when maxIntervalMs equals intervalMs", () => {
    expect(nextPollDelay(BASE, false, BASE, BASE, FACTOR)).toBe(BASE);
  });
});

describe("wakePollDelay", () => {
  it("is a no-op at base cadence, so click/keypress spam costs nothing", () => {
    const now = 1_000_000;
    expect(wakePollDelay(BASE, now, now + BASE, now, BASE)).toBeNull();
  });

  it("pulls the next run earlier when backed off", () => {
    const lastRunAt = 1_000_000;
    // Backed off to 30m; next run is 30m out. User clicks 1m after last run.
    const now = lastRunAt + 60_000;
    const delay = wakePollDelay(MAX, lastRunAt, lastRunAt + MAX, now, BASE);
    // Should target lastRunAt + 5m, i.e. 4m from now — not fire immediately.
    expect(delay).toBe(240_000);
  });

  it("never schedules two runs closer together than the base interval", () => {
    const lastRunAt = 1_000_000;
    for (let elapsed = 0; elapsed < BASE; elapsed += 15_000) {
      const now = lastRunAt + elapsed;
      const delay = wakePollDelay(MAX, lastRunAt, lastRunAt + MAX, now, BASE);
      if (delay === null) continue;
      // now + delay is when it would actually fire.
      expect(now + delay).toBeGreaterThanOrEqual(lastRunAt + BASE);
    }
  });

  it("fires immediately (0) but not sooner when already past the base interval", () => {
    const lastRunAt = 1_000_000;
    const now = lastRunAt + BASE + 120_000; // 7m since last run, backed off
    const delay = wakePollDelay(MAX, lastRunAt, lastRunAt + MAX, now, BASE);
    expect(delay).toBe(0);
  });

  it("never pushes a pending run later than it was already scheduled", () => {
    const lastRunAt = 1_000_000;
    const nextRunAt = lastRunAt + 60_000; // already due in 1m
    const now = lastRunAt + 30_000;
    // Backed-off delay, but the pending run is sooner than base allows —
    // leave it alone rather than delaying it out to lastRunAt + 5m.
    expect(wakePollDelay(MAX, lastRunAt, nextRunAt, now, BASE)).toBeNull();
  });

  it("repeated wakes never compound into a burst", () => {
    const lastRunAt = 1_000_000;
    let nextRunAt = lastRunAt + MAX;
    let currentDelay = MAX;
    const fireTimes: number[] = [];

    for (let elapsed = 10_000; elapsed < BASE; elapsed += 10_000) {
      const now = lastRunAt + elapsed;
      const delay = wakePollDelay(currentDelay, lastRunAt, nextRunAt, now, BASE);
      if (delay === null) continue;
      currentDelay = BASE;
      nextRunAt = now + delay;
      fireTimes.push(nextRunAt);
    }

    // Every wake resolves to the same single fire time — one run, not many.
    expect(new Set(fireTimes).size).toBe(1);
    expect(fireTimes[0]).toBe(lastRunAt + BASE);
  });
});
