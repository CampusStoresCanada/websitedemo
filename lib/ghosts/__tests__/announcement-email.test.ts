import { describe, it, expect } from "vitest";
import { buildAnnouncementEmail } from "@/lib/ghosts/new-partner-email";

const base = {
  organizationName: "Sock Rocket",
  organizationSlug: "sock-rocket",
  summaryText:
    "Sock Rocket is a Canadian social enterprise based in Calgary. They donate three pairs for every pair sold. Over 900,000 pairs have gone to Canadians in need. They work with Air Canada and TD Bank.",
  category: "General Merchandise",
  location: "Calgary, AB",
  circlePostUrl: "https://memberspace.campusstores.ca/c/announcements/welcome-sock-rocket",
  website: "sockrocket.ca",
};

describe("buildAnnouncementEmail", () => {
  it("names the partner in the subject", () => {
    expect(buildAnnouncementEmail(base).subject).toBe("New CSC partner: Sock Rocket");
  });

  it("leads with who joined", () => {
    expect(buildAnnouncementEmail(base).bodyHtml).toContain(
      "Sock Rocket has joined Campus Stores Canada as a Vendor Partner"
    );
  });

  it("trims a long summary to a couple of sentences", () => {
    const body = buildAnnouncementEmail(base).bodyHtml;
    expect(body).toContain("Sock Rocket is a Canadian social enterprise based in Calgary.");
    expect(body).toContain("They donate three pairs for every pair sold.");
    // The third and fourth sentences are left for the post and the profile.
    expect(body).not.toContain("Over 900,000 pairs");
    expect(body).not.toContain("Air Canada");
  });

  it("links the partner's own website, with a scheme forced on", () => {
    const body = buildAnnouncementEmail(base).bodyHtml;
    // A bare domain in an href would be a relative link going nowhere.
    expect(body).toContain('href="https://sockrocket.ca"');
    expect(body).toContain(">sockrocket.ca<");
  });

  it("omits the website line when there isn't one", () => {
    const body = buildAnnouncementEmail({ ...base, website: null }).bodyHtml;
    expect(body).not.toContain("sockrocket.ca");
    expect(body).toContain("See their profile");
  });

  it("links to the profile", () => {
    expect(buildAnnouncementEmail(base).bodyHtml).toContain("/org/sock-rocket");
  });

  it("points at the Circle post when there is one", () => {
    expect(buildAnnouncementEmail(base).bodyHtml).toContain(base.circlePostUrl);
  });

  it("omits the community line when there is no post", () => {
    const body = buildAnnouncementEmail({ ...base, circlePostUrl: null }).bodyHtml;
    expect(body).not.toContain("over in the community");
    // Still a usable email.
    expect(body).toContain("See their profile");
  });

  it("escapes HTML in partner-supplied values", () => {
    const body = buildAnnouncementEmail({
      ...base,
      organizationName: 'Socks & <script>alert("x")</script>',
    }).bodyHtml;
    expect(body).not.toContain("<script>");
    expect(body).toContain("&amp;");
    expect(body).toContain("&lt;script&gt;");
  });

  it("copes with no summary at all", () => {
    const body = buildAnnouncementEmail({ ...base, summaryText: "" }).bodyHtml;
    expect(body).toContain("has joined Campus Stores Canada");
    expect(body).toContain("See their profile");
  });

  it("keeps a summary that has no sentence punctuation", () => {
    const body = buildAnnouncementEmail({
      ...base,
      summaryText: "A custom sock manufacturer",
    }).bodyHtml;
    expect(body).toContain("A custom sock manufacturer");
  });
});
