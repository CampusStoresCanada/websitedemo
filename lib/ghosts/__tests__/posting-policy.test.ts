import { describe, it, expect } from "vitest";
import {
  canPublishAmbient,
  civilDayBounds,
  releaseMinuteOfDay,
  SPACE_DAILY_CEILING,
  PIPELINE_DAILY_CAP,
  RELEASE_WINDOW_START_HOUR,
  RELEASE_WINDOW_END_HOUR,
} from "@/lib/ghosts/posting-policy";
import { zonedTimeToUtc } from "@/lib/board/vote-schedule";

/**
 * A wall-clock moment in the association's timezone. Defaults to late in the
 * day, past any release time, so tests exercise the day-level rules rather
 * than tripping over the time-of-day gate.
 */
const et = (y: number, m: number, d: number, hh = RELEASE_WINDOW_END_HOUR + 1, mm = 0) =>
  zonedTimeToUtc(y, m, d, hh, mm);

const base = {
  pipeline: "new_partner" as const,
  postsToSpaceToday: 0,
  postsInPipelineToday: 0,
};

describe("business-day gate", () => {
  it("allows an ordinary weekday", () => {
    // Thursday
    expect(canPublishAmbient({ ...base, now: et(2026, 8, 20) }).allowed).toBe(true);
  });

  it("blocks Saturday and Sunday", () => {
    expect(canPublishAmbient({ ...base, now: et(2026, 8, 22) }).allowed).toBe(false);
    expect(canPublishAmbient({ ...base, now: et(2026, 8, 23) }).allowed).toBe(false);
  });

  it("blocks a national holiday", () => {
    const decision = canPublishAmbient({ ...base, now: et(2026, 12, 25) });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.retry).toBe("next_business_day");
  });

  it("blocks Good Friday, which moves with Easter", () => {
    // Easter Sunday 2026 is April 5 → Good Friday April 3.
    expect(canPublishAmbient({ ...base, now: et(2026, 4, 3) }).allowed).toBe(false);
  });

  it("judges the day in the association's timezone, not the server's", () => {
    // 9pm Sunday Eastern is already Monday in UTC. It must still be Sunday.
    expect(canPublishAmbient({ ...base, now: et(2026, 8, 23, 21, 0) }).allowed).toBe(false);
    // And Monday Eastern is Monday, even though at 12:30am it is still Sunday
    // in Mountain time where the operator sits. (Checked late in the day so
    // the release-time gate isn't what's being measured.)
    const mondayDecision = canPublishAmbient({ ...base, now: et(2026, 8, 24, 0, 30) });
    expect(mondayDecision.allowed).toBe(false);
    if (!mondayDecision.allowed) expect(mondayDecision.reason).toContain("release time");
    expect(canPublishAmbient({ ...base, now: et(2026, 8, 24) }).allowed).toBe(true);
  });
});

describe("per-space daily ceiling", () => {
  it("allows posts below the ceiling", () => {
    expect(
      canPublishAmbient({ ...base, now: et(2026, 8, 20), postsToSpaceToday: SPACE_DAILY_CEILING - 1 })
        .allowed
    ).toBe(true);
  });

  it("blocks once the ceiling is reached, whoever used it", () => {
    // The ceiling is shared across pipelines — this one has posted nothing.
    const decision = canPublishAmbient({
      ...base,
      now: et(2026, 8, 20),
      postsToSpaceToday: SPACE_DAILY_CEILING,
      postsInPipelineToday: 0,
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toContain("ghost posts today");
  });
});

describe("per-pipeline daily cap", () => {
  it("blocks a second new-partner post the same day", () => {
    const decision = canPublishAmbient({
      ...base,
      now: et(2026, 8, 20),
      postsInPipelineToday: PIPELINE_DAILY_CAP.new_partner,
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toContain("new_partner");
  });

  it("caps the pipeline even when the space has room", () => {
    // Space ceiling is 3 and only 1 has been used — but new_partner's own cap is 1.
    expect(
      canPublishAmbient({
        ...base,
        now: et(2026, 8, 20),
        postsToSpaceToday: 1,
        postsInPipelineToday: 1,
      }).allowed
    ).toBe(false);
  });
});

describe("the cap is the backfill spacer", () => {
  it("releases a queue of four over four separate business days", () => {
    // Simulate the backfill: four approved items, one cron tick per day.
    // Late in each day, past the release time, so this measures the daily cap
    // and the weekend skip rather than the time-of-day gate.
    const days = [
      et(2026, 8, 20), // Thu
      et(2026, 8, 21), // Fri
      et(2026, 8, 22), // Sat — blocked
      et(2026, 8, 23), // Sun — blocked
      et(2026, 8, 24), // Mon
      et(2026, 8, 25), // Tue
    ];

    let remaining = 4;
    const releasedOn: string[] = [];

    for (const now of days) {
      // Fresh day: nothing posted yet.
      const decision = canPublishAmbient({ ...base, now });
      if (decision.allowed && remaining > 0) {
        remaining--;
        releasedOn.push(now.toISOString().slice(0, 10));
      }
    }

    expect(remaining).toBe(0);
    expect(releasedOn).toHaveLength(4);
    // Thu, Fri, Mon, Tue — the weekend is skipped without any extra logic.
    expect(releasedOn).toEqual(["2026-08-20", "2026-08-21", "2026-08-24", "2026-08-25"]);
  });
});

describe("civilDayBounds", () => {
  it("spans midnight to midnight in the association's timezone", () => {
    // Aug 20 2026 is EDT (UTC-4), so the civil day starts at 04:00 UTC.
    const { startUtc, endUtc } = civilDayBounds(et(2026, 8, 20, 15, 0));
    expect(startUtc).toBe("2026-08-20T04:00:00.000Z");
    expect(endUtc).toBe("2026-08-21T04:00:00.000Z");
  });

  it("shifts correctly in winter", () => {
    // January is EST (UTC-5) → the civil day starts at 05:00 UTC.
    const { startUtc } = civilDayBounds(et(2026, 1, 14, 15, 0));
    expect(startUtc).toBe("2026-01-14T05:00:00.000Z");
  });

  it("puts a late-evening Eastern moment in the correct civil day", () => {
    // 11pm Aug 20 Eastern is already Aug 21 in UTC — the day must still be the 20th.
    const { startUtc } = civilDayBounds(et(2026, 8, 20, 23, 0));
    expect(startUtc).toBe("2026-08-20T04:00:00.000Z");
  });
});


describe("release time varies by day, deterministically", () => {
  it("is stable for the same day — the same answer on every tick", () => {
    const a = releaseMinuteOfDay("2026-08-20", "new_partner");
    const b = releaseMinuteOfDay("2026-08-20", "new_partner");
    expect(a).toBe(b);
  });

  it("differs across days, so posts don't land at the same time daily", () => {
    const week = ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21"].map((d) =>
      releaseMinuteOfDay(d, "new_partner")
    );
    // Not all the same — that is the whole point of the exercise.
    expect(new Set(week).size).toBeGreaterThan(1);
  });

  it("always lands inside the business-hours window", () => {
    for (let day = 1; day <= 28; day++) {
      const date = `2026-09-${String(day).padStart(2, "0")}`;
      const minute = releaseMinuteOfDay(date, "new_partner");
      expect(minute).toBeGreaterThanOrEqual(RELEASE_WINDOW_START_HOUR * 60);
      expect(minute).toBeLessThan(RELEASE_WINDOW_END_HOUR * 60);
    }
  });

  it("holds an item before the release time and lets it through after", () => {
    const target = releaseMinuteOfDay("2026-08-20", "new_partner");
    const before = canPublishAmbient({
      ...base,
      now: zonedTimeToUtc(2026, 8, 20, Math.floor((target - 30) / 60), (target - 30) % 60),
    });
    const after = canPublishAmbient({
      ...base,
      now: zonedTimeToUtc(2026, 8, 20, Math.floor((target + 5) / 60), (target + 5) % 60),
    });

    expect(before.allowed).toBe(false);
    if (!before.allowed) expect(before.retry).toBe("retry_later");
    expect(after.allowed).toBe(true);
  });

  it("never releases at exactly the top of the hour on every day", () => {
    const minutes = Array.from({ length: 30 }, (_, i) =>
      releaseMinuteOfDay(`2026-10-${String(i + 1).padStart(2, "0")}`, "new_partner") % 60
    );
    // A machine posting on the hour would give 0 every time.
    expect(minutes.filter((m) => m === 0).length).toBeLessThan(5);
  });
});
