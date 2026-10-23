import { describe, expect, it } from "vitest";
import { afterWrongPin, deskPinChangeAllowed, deskPinMatches, hashDeskPin, isValidDeskPin } from "../desk-pin";

describe("desk PIN", () => {
  it("accepts 4 to 6 digits and nothing else", () => {
    expect(["1234", "12345", "123456"].every(isValidDeskPin)).toBe(true);
    expect(["123", "1234567", "12a4", " 1234", ""].some(isValidDeskPin)).toBe(false);
  });

  it("never stores the digits, and matches only the right PIN", () => {
    const stored = hashDeskPin("4821");
    expect(stored).not.toContain("4821");
    expect(deskPinMatches("4821", stored)).toBe(true);
    expect(deskPinMatches("4822", stored)).toBe(false);
  });

  it("salts every hash, so two people with the same PIN do not look alike", () => {
    expect(hashDeskPin("1111")).not.toBe(hashDeskPin("1111"));
  });

  it("rejects a malformed stored value rather than throwing", () => {
    expect(deskPinMatches("1234", "plain-text")).toBe(false);
  });

  it("locks out on the fifth wrong try", () => {
    expect(afterWrongPin(0)).toEqual({ failed: 1, left: 4, lockedOut: false });
    expect(afterWrongPin(3)).toEqual({ failed: 4, left: 1, lockedOut: false });
    expect(afterWrongPin(4)).toEqual({ failed: 5, left: 0, lockedOut: true });
  });
});

describe("who may choose a new desk PIN", () => {
  it("a fresh password sign-in, or the current PIN", () => {
    expect(deskPinChangeAllowed({ currentPinOk: false, signedInRecently: true })).toBe(true);
    expect(deskPinChangeAllowed({ currentPinOk: true, signedInRecently: false })).toBe(true);
  });

  it("never just because there is no PIN — a lockout is not a reset", () => {
    expect(deskPinChangeAllowed({ currentPinOk: false, signedInRecently: false })).toBe(false);
  });
});
