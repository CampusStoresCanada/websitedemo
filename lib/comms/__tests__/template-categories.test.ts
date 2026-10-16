import { describe, it, expect } from "vitest";
import {
  groupTemplatesByCategory,
  templateCategoryLabel,
  humanizeTemplateCategory,
  TEMPLATE_CATEGORY_OPTIONS,
  TEMPLATE_CATEGORY_ORDER,
} from "../template-categories";

const row = (category: string, id: string) => ({ id, category });

describe("groupTemplatesByCategory", () => {
  it("keeps every row — group sizes sum back to the input length", () => {
    // The real shape of the library as of the bug report: 58 shared-library
    // templates across six categories, of which the old hardcoded order
    // listed only renewal + user_mgmt + conference + general = 31.
    const templates = [
      ...Array.from({ length: 8 }, (_, i) => row("renewal", `r${i}`)),
      ...Array.from({ length: 9 }, (_, i) => row("user_mgmt", `u${i}`)),
      ...Array.from({ length: 13 }, (_, i) => row("conference", `c${i}`)),
      ...Array.from({ length: 7 }, (_, i) => row("events", `e${i}`)),
      ...Array.from({ length: 15 }, (_, i) => row("governance", `g${i}`)),
      ...Array.from({ length: 5 }, (_, i) => row("benchmarking", `b${i}`)),
      row("general", "gen0"),
    ];
    expect(templates).toHaveLength(58);

    const groups = groupTemplatesByCategory(templates);
    const rendered = groups.reduce((n, g) => n + g.templates.length, 0);

    expect(rendered).toBe(templates.length);
    expect(groups.map((g) => g.category).sort()).toEqual([
      "benchmarking",
      "conference",
      "events",
      "general",
      "governance",
      "renewal",
      "user_mgmt",
    ]);
  });

  it("gives a category nobody declared its own heading instead of dropping it", () => {
    const groups = groupTemplatesByCategory([
      row("renewal", "a"),
      row("sponsor_outreach", "b"),
    ]);

    expect(groups.reduce((n, g) => n + g.templates.length, 0)).toBe(2);
    const unknown = groups.find((g) => g.category === "sponsor_outreach");
    expect(unknown?.label).toBe("Sponsor Outreach");
  });

  it("buckets a blank category rather than losing the row", () => {
    const groups = groupTemplatesByCategory([row("", "a"), row("   ", "b")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].templates).toHaveLength(2);
    expect(groups[0].label).toBe("Uncategorized");
  });

  it("orders known categories by TEMPLATE_CATEGORY_ORDER, unknown ones last", () => {
    const groups = groupTemplatesByCategory([
      row("zzz_custom", "a"),
      row("general", "b"),
      row("renewal", "c"),
      row("aaa_custom", "d"),
    ]);
    expect(groups.map((g) => g.category)).toEqual([
      "renewal",
      "general",
      "aaa_custom",
      "zzz_custom",
    ]);
  });
});

describe("templateCategoryLabel", () => {
  it("names the categories that were previously invisible", () => {
    expect(templateCategoryLabel("benchmarking")).toBe("Benchmarking");
    expect(templateCategoryLabel("governance")).toBe("Governance");
    expect(templateCategoryLabel("events")).toBe("Events");
    expect(templateCategoryLabel("announcement")).toBe("Announcement");
  });

  it("never returns an empty heading", () => {
    for (const v of [null, undefined, "", "  "]) {
      expect(templateCategoryLabel(v)).toBe("Uncategorized");
    }
  });
});

describe("humanizeTemplateCategory", () => {
  it("title-cases snake_case and kebab-case", () => {
    expect(humanizeTemplateCategory("user_mgmt")).toBe("User Mgmt");
    expect(humanizeTemplateCategory("board-elections")).toBe("Board Elections");
  });
});

describe("TEMPLATE_CATEGORY_OPTIONS", () => {
  it("offers every declared category for authoring, including the new ones", () => {
    const values = TEMPLATE_CATEGORY_OPTIONS.map((o) => o.value);
    expect(values).toContain("benchmarking");
    expect(values).toContain("governance");
    expect(values).toContain("events");
  });

  it("every option is in the display order, so none sorts arbitrarily", () => {
    for (const o of TEMPLATE_CATEGORY_OPTIONS) {
      expect(TEMPLATE_CATEGORY_ORDER).toContain(o.value);
    }
  });
});
