import { describe, it, expect } from "vitest";
import {
  buildNewPartnerPost,
  displayUrl,
  formatLocation,
  ensureAbsoluteUrl,
  splitCategories,
  type NewPartnerPostInput,
} from "@/lib/ghosts/new-partner-post";

/** Sock Rocket, verbatim from the organizations row. */
const SOCK_ROCKET: NewPartnerPostInput["organization"] = {
  name: "Sock Rocket",
  slug: "sock-rocket",
  website: "https://sockrocket.ca/",
  city: "Calgary",
  province: "Alberta",
  primaryCategory: "General Merchandise, Apparel & Spirit Wear, Gifts & Collectibles",
  websiteSummary:
    "Sock Rocket is a Canadian social enterprise based in Calgary that donates three pairs of socks for every pair sold.",
  companyDescription:
    "Hello! We are Sock Rocket - a custom sock manufacturer who donates 3 pairs for every pair sold.",
};

const make = (overrides: Partial<NewPartnerPostInput> = {}): NewPartnerPostInput => ({
  organization: SOCK_ROCKET,
  joinedOn: "2026-08-13",
  appUrl: "https://campusstores.ca",
  ...overrides,
});

function plainText(post: ReturnType<typeof buildNewPartnerPost>): string {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== "object") return;
    const node = n as Record<string, unknown>;
    if (typeof node.text === "string") out.push(node.text);
    const attrs = node.attrs as Record<string, unknown> | undefined;
    if (attrs && typeof attrs.label === "string") out.push(attrs.label);
    if (node.content) walk(node.content);
  };
  walk(post.tiptap_body.body.content);
  return out.join(" ");
}

const nodeTypes = (post: ReturnType<typeof buildNewPartnerPost>) =>
  post.tiptap_body.body.content.map((n) => (n as Record<string, unknown>).type);

describe("formatters", () => {
  it("abbreviates the province", () => {
    expect(formatLocation("Calgary", "Alberta")).toBe("Calgary, AB");
  });

  it("leaves an unrecognised province alone", () => {
    // Real value on Ambassador's row.
    expect(formatLocation("Melville, NY, USA", "Out of Canada")).toBe(
      "Melville, NY, USA, Out of Canada"
    );
  });

  it("copes with a missing half", () => {
    expect(formatLocation(null, "Ontario")).toBe("ON");
    expect(formatLocation("Markham", null)).toBe("Markham");
  });

  it("strips protocol and trailing slash", () => {
    expect(displayUrl("https://sockrocket.ca/")).toBe("sockrocket.ca");
  });
});

describe("buildNewPartnerPost", () => {
  it("titles the post as a welcome", () => {
    expect(buildNewPartnerPost(make()).title).toBe("Welcome, Sock Rocket");
  });

  it("opens by saying who joined and what they are", () => {
    expect(plainText(buildNewPartnerPost(make()))).toContain(
      "Sock Rocket has joined Campus Stores Canada as a Vendor Partner"
    );
  });

  it("narrates using the third-person website summary", () => {
    const body = plainText(buildNewPartnerPost(make()));
    expect(body).toContain("Sock Rocket is a Canadian social enterprise");
    // The first-person copy must not be narrated as if the ghost wrote it.
    expect(body).not.toContain("Hello! We are Sock Rocket");
    expect(body).not.toContain("In their own words");
  });

  it("quotes the partner's own copy when there is no summary", () => {
    const input = make();
    input.organization = { ...SOCK_ROCKET, websiteSummary: null };
    const body = plainText(buildNewPartnerPost(input));
    // Attributed and quoted, so the first person reads correctly.
    expect(body).toContain("In their own words");
    expect(body).toContain("“Hello! We are Sock Rocket");
  });

  it("says nothing about the business when neither is available", () => {
    const input = make();
    input.organization = { ...SOCK_ROCKET, websiteSummary: null, companyDescription: null };
    const post = buildNewPartnerPost(input);
    const body = plainText(post);
    expect(body).not.toContain("In their own words");
    // Still a usable post — it introduces them, carries the details, and
    // offers a way through, even with nothing written about the business.
    expect(post.title).toBe("Welcome, Sock Rocket");
    expect(body).toContain("has joined Campus Stores Canada");
    expect(body).toContain("Calgary, AB");
    expect(nodeTypes(post).filter((t) => t === "cta")).toHaveLength(1);
  });

  it("includes categories, location and website", () => {
    const body = plainText(buildNewPartnerPost(make()));
    expect(body).toContain("Calgary, AB");
    expect(body).toContain("sockrocket.ca");
  });

  it("shows every subcategory, not just the parent", () => {
    // "General Merchandise" alone covers a huge share of the industry; the
    // subcategories are what tell a member whether to care.
    const body = plainText(buildNewPartnerPost(make()));
    expect(body).toContain("Categories");
    expect(body).toContain("General Merchandise, Apparel & Spirit Wear, Gifts & Collectibles");
  });

  it("uses the singular label when there is only one category", () => {
    const input = make();
    input.organization = { ...SOCK_ROCKET, primaryCategory: "Course Materials" };
    const body = plainText(buildNewPartnerPost(input));
    expect(body).toContain("Category");
    expect(body).not.toContain("Categories");
  });

  it("links through to the profile with a single CTA", () => {
    const post = buildNewPartnerPost(make());
    const ctas = post.tiptap_body.body.content.filter(
      (n) => (n as Record<string, unknown>).type === "cta"
    ) as Array<{ attrs: Record<string, string> }>;

    expect(ctas).toHaveLength(1);
    expect(ctas[0].attrs.url).toBe("https://campusstores.ca/org/sock-rocket");
    expect(ctas[0].attrs.color).toBe("#B92026");
    expect(ctas[0].attrs.label).toBe("View Sock Rocket");
  });

  it("does not double up the slash when appUrl has a trailing one", () => {
    const post = buildNewPartnerPost(make({ appUrl: "https://campusstores.ca/" }));
    const cta = post.tiptap_body.body.content.find(
      (n) => (n as Record<string, unknown>).type === "cta"
    ) as { attrs: Record<string, string> };
    expect(cta.attrs.url).toBe("https://campusstores.ca/org/sock-rocket");
  });

  it("uses only node types Circle is verified to render", () => {
    // `poll` is accepted with HTTP 200 and silently dropped — it must never appear.
    const allowed = new Set(["paragraph", "heading", "horizontalRule", "cta"]);
    for (const type of nodeTypes(buildNewPartnerPost(make()))) {
      expect(allowed.has(type as string)).toBe(true);
    }
  });

  it("degrades gracefully on a sparse org", () => {
    const post = buildNewPartnerPost(
      make({ organization: { name: "Minimal Co", slug: "minimal-co" } })
    );
    expect(post.title).toBe("Welcome, Minimal Co");
    expect(nodeTypes(post).filter((t) => t === "cta")).toHaveLength(1);
  });
});


describe("ensureAbsoluteUrl", () => {
  it("leaves an absolute URL alone", () => {
    expect(ensureAbsoluteUrl("https://sockrocket.ca/")).toBe("https://sockrocket.ca/");
    expect(ensureAbsoluteUrl("http://example.com")).toBe("http://example.com");
  });

  it("rescues a bare domain, which would otherwise be a relative link", () => {
    // 30 of 75 partner websites are stored like this. Left alone, the href
    // resolves against campusstores.ca and goes nowhere.
    expect(ensureAbsoluteUrl("lifestylemarket.ca")).toBe("https://lifestylemarket.ca");
    expect(ensureAbsoluteUrl("www.thesomcangroup.com")).toBe("https://www.thesomcangroup.com");
  });

  it("returns empty for nothing", () => {
    expect(ensureAbsoluteUrl(null)).toBe("");
    expect(ensureAbsoluteUrl("   ")).toBe("");
  });
});

describe("the website link is always absolute", () => {
  it("prepends a scheme to a bare domain in the href, but not the label", () => {
    const input = make();
    input.organization = { ...SOCK_ROCKET, website: "sockrocket.ca" };
    const post = buildNewPartnerPost(input);

    const json = JSON.stringify(post.tiptap_body);
    expect(json).toContain('"href":"https://sockrocket.ca"');
    // The visible text stays clean — no protocol shown to the reader.
    expect(plainText(post)).toContain("sockrocket.ca");
  });
});

describe("splitCategories", () => {
  it("splits the flat comma-separated string the profile stores", () => {
    expect(splitCategories("Apparel, Men's / Unisex, Women's")).toEqual([
      "Apparel",
      "Men's / Unisex",
      "Women's",
    ]);
  });

  it("drops empties and stray whitespace", () => {
    expect(splitCategories("Apparel, , Youth ,")).toEqual(["Apparel", "Youth"]);
  });

  it("copes with null", () => {
    expect(splitCategories(null)).toEqual([]);
  });
});
