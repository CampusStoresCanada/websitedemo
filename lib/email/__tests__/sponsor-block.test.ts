import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data", () => ({ getPlatformIdentity: async () => ({ clientName: "CSC", supportEmail: null }) }));
const loadEmailSponsors = vi.fn();
vi.mock("@/lib/sponsorship/email-sponsors", () => ({ loadEmailSponsors: () => loadEmailSponsors() }));

import { renderSponsorBlock, wrapEmailBody } from "../layout";
import type { SponsorInSlot } from "@/lib/sponsorship/types";

const tier = { name: "Sponsor", slug: "custom", color: null, icon: null };
const kivuto: SponsorInSlot = {
  agreementId: "a1", organizationName: "Kivuto", organizationSlug: "kivuto",
  logoUrl: "https://cdn.example/kivuto.png", linkUrl: "https://kivuto.com", tier,
};

describe("email sponsor block", () => {
  it("thanks sponsors with a linked logo row", () => {
    const html = renderSponsorBlock([kivuto]);
    expect(html).toContain("And thanks to our sponsors");
    expect(html).toContain('<a href="https://kivuto.com"');
    expect(html).toContain('alt="Kivuto"');
  });

  it("renders nothing when there is nobody with a logo to thank", () => {
    expect(renderSponsorBlock([])).toBe("");
    expect(renderSponsorBlock([{ ...kivuto, logoUrl: null }])).toBe("");
  });

  it("escapes names and links", () => {
    const html = renderSponsorBlock([{ ...kivuto, organizationName: 'A "B" <C>' }]);
    expect(html).toContain('alt="A &quot;B&quot; &lt;C&gt;"');
  });

  it("goes above the mailing address on commercial mail", async () => {
    loadEmailSponsors.mockResolvedValue([kivuto]);
    const html = await wrapEmailBody("<p>Hi</p>", "https://x.test", "https://x.test/manage");
    expect(html.indexOf("And thanks to our sponsors")).toBeGreaterThan(html.indexOf("<p>Hi</p>"));
    expect(html.indexOf("And thanks to our sponsors")).toBeLessThan(html.indexOf("P.O. Box"));
  });

  it("never appears on transactional mail, and does not look sponsors up", async () => {
    loadEmailSponsors.mockClear();
    const html = await wrapEmailBody("<p>Reset</p>", "https://x.test");
    expect(html).not.toContain("And thanks to our sponsors");
    expect(loadEmailSponsors).not.toHaveBeenCalled();
  });
});
