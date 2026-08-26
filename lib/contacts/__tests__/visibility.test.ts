import { describe, expect, it } from "vitest";
import {
  canPrint, hasDecided, isVisibleTo, resolveWebVisibility,
  type VisibilitySource,
} from "../visibility";

const c = (over: VisibilitySource = {}): VisibilitySource => ({ ...over });

describe("the website falls back while someone is undecided", () => {
  it("keeps an un-answered person visible to members, as today", () => {
    // The migration must not move ~880 people who never opted out. They are
    // being asked; punishing them for not having answered yet is the wrong way
    // round.
    expect(resolveWebVisibility(c())).toBe("members");
    expect(resolveWebVisibility(c({ hidden: false }))).toBe("members");
  });

  it("still honours an existing opt-out", () => {
    expect(resolveWebVisibility(c({ hidden: true }))).toBe("hidden");
  });

  it("lets the person's own answer override the legacy flag", () => {
    expect(resolveWebVisibility(c({ hidden: true, directory_visibility: "public" }))).toBe("public");
    expect(resolveWebVisibility(c({ hidden: false, directory_visibility: "hidden" }))).toBe("hidden");
  });
});

describe("who can see whom", () => {
  it("shows administrators everyone, including people who chose to be hidden", () => {
    // Not a privacy hole — stated plainly in the choice itself. Support and
    // billing cannot work against a directory with holes in it.
    expect(isVisibleTo(c({ directory_visibility: "hidden" }), "admin")).toBe(true);
  });

  it("keeps members-only people off public pages", () => {
    const person = c({ directory_visibility: "members" });
    expect(isVisibleTo(person, "member")).toBe(true);
    expect(isVisibleTo(person, "public")).toBe(false);
  });

  it("shows public people to everyone", () => {
    const person = c({ directory_visibility: "public" });
    expect(isVisibleTo(person, "public")).toBe(true);
    expect(isVisibleTo(person, "member")).toBe(true);
  });

  it("hides hidden people from members and the public alike", () => {
    const person = c({ directory_visibility: "hidden" });
    expect(isVisibleTo(person, "member")).toBe(false);
    expect(isVisibleTo(person, "public")).toBe(false);
  });
});

describe("print is strict opt-in — a different rule on purpose", () => {
  it("does NOT print someone who has not answered", () => {
    // The whole point. An undecided person stays visible on the website, where
    // a mistake is fixable, and stays OUT of the book, where it is not.
    expect(canPrint(c())).toBe(false);
    expect(canPrint(c({ hidden: false }))).toBe(false);
    expect(resolveWebVisibility(c())).toBe("members"); // visible on the site…
    expect(canPrint(c())).toBe(false); // …and still not in the book
  });

  it("prints only on an explicit yes", () => {
    expect(canPrint(c({ directory_visibility: "members" }))).toBe(true);
    expect(canPrint(c({ directory_visibility: "public" }))).toBe(true);
  });

  it("never prints someone who chose hidden", () => {
    expect(canPrint(c({ directory_visibility: "hidden" }))).toBe(false);
  });

  it("cannot be satisfied by the legacy flag alone", () => {
    // hidden=false is the ABSENCE of an opt-out, not the presence of consent.
    // Treating it as a yes would silently print everyone who was never asked.
    expect(canPrint(c({ hidden: false }))).toBe(false);
  });
});

describe("hasDecided", () => {
  it("is false until the person actually answers", () => {
    expect(hasDecided(c())).toBe(false);
    expect(hasDecided(c({ hidden: true }))).toBe(false);
    expect(hasDecided(c({ directory_visibility: "hidden" }))).toBe(true);
  });

  it("ignores a value outside the three states", () => {
    expect(hasDecided(c({ directory_visibility: "yes" }))).toBe(false);
    expect(resolveWebVisibility(c({ directory_visibility: "yes" }))).toBe("members");
  });
});
