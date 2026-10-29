import { describe, expect, it } from "vitest";
import { renderBadgeHtml } from "../render-html";
import {
  DEFAULT_BADGE_TEMPLATE_CONFIG_V1,
  type BadgePersonRecord,
  type BadgeTemplateConfigV1,
} from "../template";

/**
 * The last name sits one line above a title at a FIXED baseline.
 *
 * ⛔ "Test Full Conference" printed as two lines at full size, and the second
 * line landed on top of the title. A last name shrinks to one line first; only
 * one that cannot fit even at the slot minimum wraps, and then the title moves
 * down by the extra line. These pin both halves against the CSC 2027 slots.
 */

const TEMPLATE: BadgeTemplateConfigV1 = {
  ...DEFAULT_BADGE_TEMPLATE_CONFIG_V1,
  front: {
    ...DEFAULT_BADGE_TEMPLATE_CONFIG_V1.front,
    lastName: {
      ...DEFAULT_BADGE_TEMPLATE_CONFIG_V1.front.lastName,
      x: 113,
      width: 749,
      baselineY: 931,
      defaultPt: 29,
      minPt: 12,
      maxLines: 2,
      height: undefined,
    },
    title: {
      ...DEFAULT_BADGE_TEMPLATE_CONFIG_V1.front.title,
      x: 113,
      width: 749,
      baselineY: 1040,
      defaultPt: 14,
      minPt: 9,
      maxLines: 3,
      lineHeight: 1.2,
      height: undefined,
    },
  },
};

const PERSON: BadgePersonRecord = {
  id: "person-1",
  variantKey: "type-1",
  variantName: "Delegate",
  displayName: null,
  firstName: "Ada",
  lastName: "Lovelace",
  roleTitle: "Bookstore Manager",
  organizationName: "Sundry Goods",
  logoUrl: null,
  qrPayload: "",
  qrImageDataUri: null,
  organizationSlug: "sundry-goods",
  orgQrImageDataUri: null,
  latitude: null,
  longitude: null,
  city: "Toronto",
  province: "ON",
  organizationType: "Member",
  access: null,
  agenda: [],
};

type Block = { top: number; height: number; lines: string[]; fontPx: number };

/** Every text block on the front, by the text it prints. */
function blocks(person: BadgePersonRecord): Block[] {
  const html = renderBadgeHtml({ template: TEMPLATE, person, side: "front", venueAddress: "", onsiteContact: null });
  const out: Block[] = [];
  for (const m of html.matchAll(/<div class="slot-text" style="[^"]*top:([\d.]+)px;[^"]*height:([\d.]+)px;[^"]*">(.*?)<\/div><\/div>/g)) {
    const lines = [...m[3].matchAll(/font-size:([\d.]+)px;[^>]*>([^<]*)/g)];
    out.push({
      top: Number(m[1]),
      height: Number(m[2]),
      lines: lines.map((l) => l[2]),
      fontPx: Number(lines[0]?.[1] ?? 0),
    });
  }
  return out;
}

const find = (all: Block[], text: string) => {
  const b = all.find((x) => x.lines.join(" ").includes(text));
  if (!b) throw new Error(`no block printing ${text}`);
  return b;
};

/** Bottom of the last line's descenders, against the top of the title box. */
function clearance(person: BadgePersonRecord): number {
  const all = blocks(person);
  const last = find(all, person.lastName!.split(" ")[0]);
  const title = find(all, person.roleTitle!.split(" ")[0]);
  const lineBottom = last.top + last.lines.length * last.fontPx * 1.02;
  return title.top - lineBottom;
}

describe("the last name never prints on the title", () => {
  it("shrinks a two-word surname onto one line rather than wrapping it", () => {
    const person = { ...PERSON, lastName: "Test Full Conference" };
    expect(find(blocks(person), "Test").lines).toEqual(["Test Full Conference"]);
    expect(clearance(person)).toBeGreaterThan(0);
  });

  it("wraps a surname too long for one line, and moves the title below it", () => {
    const person = { ...PERSON, lastName: "Wolfeschlegelsteinhausenbergerdorff Featherstonehaugh" };
    const plain = find(blocks(PERSON), "Bookstore");
    const moved = find(blocks(person), "Bookstore");
    expect(find(blocks(person), "Wolfeschlegelsteinhausenbergerdorff").lines).toHaveLength(2);
    expect(moved.top).toBeGreaterThan(plain.top);
    expect(clearance(person)).toBeGreaterThan(0);
  });

  it("leaves an ordinary name and its title exactly where the template puts them", () => {
    const all = blocks(PERSON);
    expect(find(all, "Lovelace").lines).toEqual(["Lovelace"]);
    expect(clearance(PERSON)).toBeGreaterThan(0);
  });
});
