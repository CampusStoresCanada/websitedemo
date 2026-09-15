import { describe, it, expect } from "vitest";
import {
  applyPresentationMode,
  canUsePresentationMode,
  readPresentationMode,
  PREFERENCE_KEY,
  PRESENTATION_LEVELS,
  type PresentationLevel,
} from "../mode";
import type { ViewerLevel } from "@/lib/visibility/defaults";

const EVERY_VIEWER_LEVEL: ViewerLevel[] = [
  "public",
  "authenticated",
  "partner",
  "member",
  "org_admin",
  "admin",
  "super_admin",
];

describe("canUsePresentationMode", () => {
  it("is staff only", () => {
    expect(canUsePresentationMode("super_admin")).toBe(true);
    expect(canUsePresentationMode("admin")).toBe(true);
    expect(canUsePresentationMode("user")).toBe(false);
  });
});

describe("applyPresentationMode", () => {
  it("lowers a staff viewer to the presented audience", () => {
    for (const level of PRESENTATION_LEVELS) {
      expect(applyPresentationMode("super_admin", level)).toBe(level);
      expect(applyPresentationMode("admin", level)).toBe(level);
    }
  });

  it("is a no-op when the mode is off", () => {
    for (const actual of EVERY_VIEWER_LEVEL) {
      expect(applyPresentationMode(actual, null)).toBe(actual);
    }
  });

  /**
   * The safety property. Presentation mode exists to withhold, so a stray
   * preference on a row that is not staff must never hand anyone a level they
   * did not earn — including the case where the stored value out-ranks them.
   */
  it("never raises a non-staff viewer, whatever is stored", () => {
    const nonStaff: ViewerLevel[] = [
      "public",
      "authenticated",
      "partner",
      "member",
      "org_admin",
    ];

    for (const actual of nonStaff) {
      for (const level of PRESENTATION_LEVELS) {
        expect(applyPresentationMode(actual, level)).toBe(actual);
      }
    }
  });

  it("maps 'public' to the signed-out level, not 'authenticated'", () => {
    expect(applyPresentationMode("super_admin", "public")).toBe("public");
  });
});

describe("readPresentationMode", () => {
  const profileWith = (value: unknown) => ({
    preferences: { [PREFERENCE_KEY]: value },
  });

  it("reads a stored level for a staff account", () => {
    for (const level of PRESENTATION_LEVELS) {
      expect(readPresentationMode(profileWith(level), "super_admin")).toBe(level);
    }
  });

  it("is off for an account that may not use it, even when set", () => {
    expect(readPresentationMode(profileWith("member"), "user")).toBeNull();
  });

  it("is off for absent, empty, or malformed preferences", () => {
    expect(readPresentationMode(null, "admin")).toBeNull();
    expect(readPresentationMode(undefined, "admin")).toBeNull();
    expect(readPresentationMode({}, "admin")).toBeNull();
    expect(readPresentationMode({ preferences: null }, "admin")).toBeNull();
    expect(readPresentationMode({ preferences: "member" }, "admin")).toBeNull();
    expect(readPresentationMode({ preferences: [] }, "admin")).toBeNull();
  });

  it("rejects a stored value that is not one of the levels", () => {
    expect(readPresentationMode(profileWith("super_admin"), "admin")).toBeNull();
    expect(readPresentationMode(profileWith("admin"), "admin")).toBeNull();
    expect(readPresentationMode(profileWith(true), "admin")).toBeNull();
    expect(readPresentationMode(profileWith(""), "admin")).toBeNull();
  });

  it("leaves other preference keys alone when reading", () => {
    const profile = {
      preferences: {
        circle_badge_paused: true,
        [PREFERENCE_KEY]: "partner" as PresentationLevel,
      },
    };
    expect(readPresentationMode(profile, "super_admin")).toBe("partner");
    expect(profile.preferences.circle_badge_paused).toBe(true);
  });
});
