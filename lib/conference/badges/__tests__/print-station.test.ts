import { describe, expect, it } from "vitest";
import {
  claimExpired,
  hashPrintStationKey,
  keyFromAuthorization,
  newPrintStationKey,
  stationOnline,
} from "../print-station";

/**
 * ⛔ The print station prints the desk's queue straight to the QL (the print
 * dialog let the driver override every sticker's size). Its key is its own:
 * per laptop, per conference, revocable, stored only as a hash.
 */
describe("print station keys", () => {
  it("are recognisable, unique, and never stored as themselves", () => {
    const a = newPrintStationKey();
    const b = newPrintStationKey();
    expect(a).toMatch(/^cscps_[A-Za-z0-9_-]{32}$/);
    expect(a).not.toBe(b);
    expect(hashPrintStationKey(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashPrintStationKey(a)).not.toContain(a);
    expect(hashPrintStationKey(` ${a} `)).toBe(hashPrintStationKey(a));
  });

  it("are read only from a Bearer header carrying a station key", () => {
    const key = newPrintStationKey();
    expect(keyFromAuthorization(`Bearer ${key}`)).toBe(key);
    expect(keyFromAuthorization(null)).toBeNull();
    expect(keyFromAuthorization("Bearer some-session-token")).toBeNull();
    expect(keyFromAuthorization(key)).toBeNull();
  });
});

describe("is the station online", () => {
  const now = new Date("2026-10-21T15:40:00Z");
  it("for 30 seconds after it last checked in", () => {
    expect(stationOnline("2026-10-21T15:39:40Z", now)).toBe(true);
    expect(stationOnline("2026-10-21T15:39:20Z", now)).toBe(false);
    expect(stationOnline(null, now)).toBe(false);
  });

  it("reads the database's timestamps that carry no Z as UTC", () => {
    expect(stationOnline("2026-10-21T15:39:50", now)).toBe(true);
  });
});

describe("a job claimed and never reported", () => {
  // Proven 2026-10-21: a stalled station's job came back and printed.
  it("goes back to the queue after two minutes", () => {
    const now = new Date("2026-10-21T15:40:00Z");
    expect(claimExpired("2026-10-21T15:39:00Z", now)).toBe(false);
    expect(claimExpired("2026-10-21T15:37:30Z", now)).toBe(true);
    expect(claimExpired(null, now)).toBe(true);
  });
});
