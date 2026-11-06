import { describe, expect, it } from "vitest";
import {
  SELF_CHECK_IN_OFF,
  binFor,
  normalizeSelfCheckIn,
  outcomeFor,
  selfCheckInEnabled,
} from "../self-check-in";

describe("self check-in settings", () => {
  it("is off for a conference that never saved any", () => {
    for (const stored of [null, undefined, {}, [], "on", 1]) {
      const settings = normalizeSelfCheckIn(stored);
      expect(settings).toEqual(SELF_CHECK_IN_OFF);
      expect(selfCheckInEnabled(settings)).toBe(false);
    }
  });

  it("turns a route on only for a literal true", () => {
    expect(normalizeSelfCheckIn({ kiosk: "true", phone: 1 })).toMatchObject({ kiosk: false, phone: false });
    expect(normalizeSelfCheckIn({ kiosk: true })).toMatchObject({ kiosk: true, phone: false });
  });

  it("drops bins it cannot read and labels the rest", () => {
    const settings = normalizeSelfCheckIn({
      ending: "bins",
      bins: [{ from: "a", to: "f" }, { from: "M", to: "G" }, { from: "?", to: "Z" }, { label: "Rest", from: "G", to: "Z" }],
    });
    expect(settings.bins).toEqual([
      { label: "A to F", from: "A", to: "F" },
      { label: "Rest", from: "G", to: "Z" },
    ]);
  });

  it("falls back to the desk for an ending it does not know", () => {
    expect(normalizeSelfCheckIn({ ending: "teleport" }).ending).toBe("desk");
  });
});

describe("where the badge is", () => {
  const bins = normalizeSelfCheckIn({ bins: [{ from: "A", to: "F" }, { from: "G", to: "Z" }] }).bins;

  it("finds the bin by the first letter of the last name, accents folded", () => {
    expect(binFor("Émond", bins)?.label).toBe("A to F");
    expect(binFor("lovelace", bins)?.label).toBe("G to Z");
  });

  it("sends someone no bin holds to the desk", () => {
    const settings = normalizeSelfCheckIn({ ending: "bins", bins: [{ from: "A", to: "F" }] });
    expect(outcomeFor(settings, "kiosk", "Lovelace")).toEqual({ kind: "desk" });
    expect(outcomeFor(settings, "kiosk", "")).toEqual({ kind: "desk" });
  });

  it("prints stickers only from a kiosk, never from a phone", () => {
    const settings = normalizeSelfCheckIn({ ending: "spare_stickers" });
    expect(outcomeFor(settings, "kiosk", "Lovelace")).toEqual({ kind: "spare_stickers" });
    expect(outcomeFor(settings, "phone", "Lovelace")).toEqual({ kind: "desk" });
  });
});
