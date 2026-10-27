import { describe, expect, it } from "vitest";
import { badgeNames, badgeRoleTitle } from "../document";

/**
 * ⛔ ONE identity rule for the printed badge and the desk's reprint sticker.
 * The sticker split "Desk Test Thursday Only" at the LAST word and printed
 * "DESK TEST THURSDAY / Only" for a badge reading "DESK / Test Thursday Only".
 */
describe("the name on a badge and on its sticker", () => {
  it("uses the contact record's first and last name when there is one", () => {
    expect(badgeNames({ display_name: "Desk Test Thursday Only" }, { first_name: "Desk", last_name: "Test Thursday Only" }))
      .toMatchObject({ firstName: "Desk", lastName: "Test Thursday Only" });
  });

  it("otherwise takes the FIRST word as the given name", () => {
    expect(badgeNames({ display_name: "Desk Test Thursday Only" }, null))
      .toMatchObject({ firstName: "Desk", lastName: "Test Thursday Only" });
  });

  it("takes the title from the contact record, then the roster row", () => {
    expect(badgeRoleTitle({ role_title: "Buyer" }, { title: "Manager" }, null)).toBe("Manager");
    expect(badgeRoleTitle({ role_title: "Buyer" }, { title: null }, null)).toBe("Buyer");
    expect(badgeRoleTitle({}, null, { role_title: "From email match" })).toBe("From email match");
  });
});
