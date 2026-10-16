import { describe, it, expect } from "vitest";
import { isVisibleTo } from "@/lib/contacts/visibility";

/**
 * The consent rule the partner exports apply to every person before writing
 * them into a CSV.
 *
 * They used to filter on the legacy `hidden` boolean alone. That agreed with
 * the person's actual choice only because setMyDirectoryVisibility writes both
 * columns together — any other writer of either column, and the export starts
 * contradicting someone's stated wish. A downloaded CSV cannot be recalled, so
 * this asks lib/contacts/visibility.ts instead, which is where that rule lives.
 *
 * Viewer is "member": the option partners fall under is labelled
 * "Members and partners only".
 */
const inExport = (c: { hidden?: boolean | null; directory_visibility?: string | null }) =>
  isVisibleTo(c, "member");

describe("who ends up in a partner export", () => {
  it("excludes someone who chose Nobody even when the legacy flag disagrees", () => {
    // ⛔ The case the old `.not("hidden","eq",true)` filter shipped them in.
    expect(inExport({ hidden: false, directory_visibility: "hidden" })).toBe(false);
  });

  it("excludes someone who chose Nobody with both columns in step", () => {
    expect(inExport({ hidden: true, directory_visibility: "hidden" })).toBe(false);
  });

  it("excludes a legacy opt-out who has never been asked", () => {
    expect(inExport({ hidden: true, directory_visibility: null })).toBe(false);
  });

  it("includes someone who chose Members and partners only — that names partners", () => {
    expect(inExport({ hidden: false, directory_visibility: "members" })).toBe(true);
  });

  it("includes someone who chose Anyone", () => {
    expect(inExport({ hidden: false, directory_visibility: "public" })).toBe(true);
  });

  // 896 of 953 contacts today. Flipping undecided to hidden would empty the
  // export overnight and punish people for a question nobody has asked them.
  it("includes the undecided, matching what the website already shows", () => {
    expect(inExport({ hidden: false, directory_visibility: null })).toBe(true);
  });

  it("honours the choice over the flag in the other direction too", () => {
    expect(inExport({ hidden: true, directory_visibility: "public" })).toBe(true);
  });
});
