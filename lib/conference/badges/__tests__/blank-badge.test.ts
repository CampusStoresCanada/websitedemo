import { describe, expect, it } from "vitest";
import { renderBadgeHtml } from "../render-html";
import {
  DEFAULT_BADGE_TEMPLATE_CONFIG_V1,
  normalizeBadgeTemplateConfig,
  type BadgePersonRecord,
} from "../template";

/**
 * A badge for a seat nobody has been named to.
 *
 * ⛔ A blank is NOT a person with the fields left empty — it is a card with no
 * identity on it at all, and everything that identifies a holder has to be
 * absent rather than blank-but-present. Three separate places got this wrong
 * on the same 152 cards, each of which type-checked and each of which only
 * showed up in a rendered PDF:
 *
 *   1. the name block printed the literal word ATTENDEE,
 *   2. the empty QR payload was handed to a third-party QR service, and
 *   3. the caption explaining the QR printed under the space where none was.
 *
 * The unifying rule these tests pin: an empty `qrPayload` means no code and
 * nothing that talks about a code, and an empty name means nothing.
 */

const BLANK: BadgePersonRecord = {
  id: "blank:seat-1",
  variantKey: "type-1",
  variantName: "Connected Exhibitor",
  displayName: null,
  firstName: null,
  lastName: null,
  roleTitle: null,
  organizationName: "Sundry Goods",
  logoUrl: null,
  qrPayload: "",
  qrImageDataUri: null,
  organizationSlug: "sundry-goods",
  orgQrImageDataUri: "data:image/svg+xml;base64,QUJD",
  latitude: null,
  longitude: null,
  city: "Toronto",
  province: "ON",
  organizationType: "Vendor Partner",
  access: null,
  agenda: [],
};

const NAMED: BadgePersonRecord = {
  ...BLANK,
  id: "person-1",
  displayName: "Ada Lovelace",
  firstName: "Ada",
  lastName: "Lovelace",
  qrPayload: "https://example.test/scan/abc123",
  qrImageDataUri: "data:image/svg+xml;base64,WFla",
};

const render = (person: BadgePersonRecord, side: "front" | "back") =>
  renderBadgeHtml({
    template: DEFAULT_BADGE_TEMPLATE_CONFIG_V1,
    person,
    side,
    venueAddress: "1 Example Road",
    onsiteContact: { name: "Carolyn Potter", phone: "(416) 807-8700" },
  });

describe("a blank badge carries the organisation but no identity", () => {
  it("prints no name — not a placeholder word", () => {
    const html = render(BLANK, "front");
    expect(html).not.toContain("ATTENDEE");
    // The organisation is still on it: a blank belongs to a company, and the
    // front splits and upper-cases the name across two lines.
    expect(html).toContain("SUNDRY");
    expect(html).toContain("GOODS");
  });

  it("prints no scan code, and asks nobody to generate one", () => {
    const html = render(BLANK, "back");
    expect(html).not.toContain("Badge QR code");
    // ⛔ The fallback path reached api.qrserver.com. An empty payload must not
    // send a request at all, let alone print a code that resolves to nothing.
    expect(html).not.toContain("api.qrserver.com");
  });

  it("drops the caption that explains the code, since there is no code", () => {
    expect(render(BLANK, "back")).not.toContain("identifies your badge");
  });

  it("still prints the venue and the on-site contact", () => {
    const html = render(BLANK, "back");
    expect(html).toContain("1 Example Road");
    expect(html).toContain("Carolyn Potter");
  });

  // The DIRECTORY code is a fact about the company, so it prints on a blank —
  // it is only the person's own code that cannot exist. `front_qr` is not in
  // the default layer order, so the template has to opt in, as CSC's does.
  it("still carries the organisation's own directory code on the front", () => {
    const template = normalizeBadgeTemplateConfig({
      ...DEFAULT_BADGE_TEMPLATE_CONFIG_V1,
      front: {
        ...DEFAULT_BADGE_TEMPLATE_CONFIG_V1.front,
        layerOrder: [...DEFAULT_BADGE_TEMPLATE_CONFIG_V1.front.layerOrder, "front_qr"],
      },
    });
    const html = renderBadgeHtml({ template, person: BLANK, side: "front" });
    expect(html).toContain("data:image/svg+xml;base64,QUJD");
    // ...and still no personal code anywhere on it.
    expect(html).not.toContain("Badge QR code");
  });
});

describe("a named badge is unaffected", () => {
  it("keeps its name, its code and the caption", () => {
    expect(render(NAMED, "front")).toContain("ADA");
    const back = render(NAMED, "back");
    expect(back).toContain("Badge QR code");
    expect(back).toContain("identifies your badge");
  });
});
