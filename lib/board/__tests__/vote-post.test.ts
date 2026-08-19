import { describe, it, expect } from "vitest";
import {
  buildVotePost,
  formatPhoneNumber,
  displayUrl,
  formatLocation,
  formatCategories,
  type VotePostInput,
} from "@/lib/board/vote-post";
import type { PartnerApplicationData } from "@/lib/actions/applications";

/** The real Sock Rocket application, verbatim from signup_applications. */
const SOCK_ROCKET: PartnerApplicationData = {
  company_name: "Sock Rocket",
  street_address: "1212 34 Ave SE",
  city: "Calgary",
  province: "Alberta",
  postal_code: "T2G 1V7",
  primary_category: "General Merchandise",
  secondary_categories: ["Apparel & Spirit Wear", "Gifts & Collectibles"],
  website: "https://sockrocket.ca/",
  phone: "6479838862",
  contact_name: "Adam Pappas",
  contact_email: "adam@sockrocket.ca",
  brand_info: "https://sockrocket.ca/",
  company_description:
    "Hello! We are Sock Rocket - a custom sock manufacturer who donates 3 pairs for every pair sold.",
};

function makeInput(overrides: Partial<VotePostInput> = {}): VotePostInput {
  return {
    application: {
      id: "e196eea6-49cc-4717-a38a-490213fd404b",
      data: SOCK_ROCKET,
      paidAmountCents: 460000,
      paidFor: "booth",
    },
    duplicates: [],
    vote: {
      urls: {
        yes: "https://campusstores.ca/board/vote/abc123?choice=yes",
        no: "https://campusstores.ca/board/vote/abc123?choice=no",
        abstain: "https://campusstores.ca/board/vote/abc123?choice=abstain",
      },
      closesAtLabel: "Friday, August 22 at 5:00 PM ET",
      threshold: 5,
      boardSize: 9,
    },
    adminUrl: "https://campusstores.ca/admin/applications",
    ...overrides,
  };
}

/** Flatten every text node so assertions can be made on the post's prose. */
function plainText(post: ReturnType<typeof buildVotePost>): string {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== "object") return;
    const node = n as Record<string, unknown>;
    if (typeof node.text === "string") out.push(node.text);
    if (node.attrs && typeof (node.attrs as Record<string, unknown>).label === "string") {
      out.push((node.attrs as Record<string, unknown>).label as string);
    }
    if (node.content) walk(node.content);
  };
  walk(post.tiptap_body.body.content);
  return out.join(" ");
}

const nodeTypes = (post: ReturnType<typeof buildVotePost>) =>
  post.tiptap_body.body.content.map((n) => (n as Record<string, unknown>).type);

describe("formatters", () => {
  it("formats a bare 10-digit phone number", () => {
    expect(formatPhoneNumber("6479838862")).toBe("(647) 983-8862");
  });

  it("strips a leading country code", () => {
    expect(formatPhoneNumber("16479838862")).toBe("(647) 983-8862");
  });

  it("leaves an unrecognisable number untouched rather than mangling it", () => {
    expect(formatPhoneNumber("ext. 4402")).toBe("ext. 4402");
    expect(formatPhoneNumber("")).toBe("");
  });

  it("strips protocol and trailing slash for display", () => {
    expect(displayUrl("https://sockrocket.ca/")).toBe("sockrocket.ca");
  });

  it("abbreviates the province and assembles the address", () => {
    expect(formatLocation(SOCK_ROCKET)).toBe("1212 34 Ave SE, Calgary, AB T2G 1V7");
  });

  it("omits missing address parts instead of leaving empty commas", () => {
    expect(formatLocation({ ...SOCK_ROCKET, street_address: "", postal_code: "" })).toBe(
      "Calgary, AB"
    );
  });

  it("joins primary and secondary categories", () => {
    expect(formatCategories(SOCK_ROCKET)).toBe(
      "General Merchandise: Apparel & Spirit Wear, Gifts & Collectibles"
    );
  });

  it("handles a primary category with no secondaries", () => {
    expect(formatCategories({ ...SOCK_ROCKET, secondary_categories: [] })).toBe(
      "General Merchandise"
    );
  });
});

describe("buildVotePost", () => {
  it("titles the post after the company", () => {
    expect(buildVotePost(makeInput()).name).toBe("Partner application — Sock Rocket");
  });

  it("states the threshold and deadline up front", () => {
    const body = plainText(buildVotePost(makeInput()));
    expect(body).toContain("5 of 9 votes in favour");
    expect(body).toContain("Friday, August 22 at 5:00 PM ET");
  });

  it("includes the applicant's details, with the phone formatted", () => {
    const body = plainText(buildVotePost(makeInput()));
    expect(body).toContain("Adam Pappas | adam@sockrocket.ca | (647) 983-8862");
    expect(body).toContain("1212 34 Ave SE, Calgary, AB T2G 1V7");
    expect(body).toContain("General Merchandise: Apparel & Spirit Wear");
  });

  it("suppresses brand_info when it merely repeats the website", () => {
    // Real data: Sock Rocket's brand_info is the website URL again.
    expect(plainText(buildVotePost(makeInput()))).not.toContain("Brand info");
  });

  it("keeps brand_info when it says something new", () => {
    const input = makeInput();
    input.application.data = { ...SOCK_ROCKET, brand_info: "Also distributes under 'Rocket Co.'" };
    expect(plainText(buildVotePost(input))).toContain("Also distributes under 'Rocket Co.'");
  });

  it("reports a pre-paid booth as an ordinary field", () => {
    expect(plainText(buildVotePost(makeInput()))).toContain("$4,600.00 for a booth");
  });

  it("omits the paid line when nothing was paid", () => {
    const input = makeInput();
    input.application.paidAmountCents = null;
    expect(plainText(buildVotePost(input))).not.toContain("Paid");
  });

  it("emits exactly three CTA buttons, in brand colours", () => {
    const post = buildVotePost(makeInput());
    const ctas = post.tiptap_body.body.content.filter(
      (n) => (n as Record<string, unknown>).type === "cta"
    ) as Array<{ attrs: Record<string, string> }>;

    expect(ctas).toHaveLength(3);
    expect(ctas.map((c) => c.attrs.label)).toEqual(["Vote Yes", "Vote No", "Abstain"]);
    expect(ctas[0].attrs.color).toBe("#B92026");
    expect(ctas[0].attrs.url).toContain("choice=yes");
  });

  it("omits plain-link fallbacks by default — CTAs confirmed working in the iOS app", () => {
    expect(plainText(buildVotePost(makeInput()))).not.toContain("Buttons not showing?");
  });

  it("can re-enable the fallback if Circle's CTA rendering ever regresses", () => {
    const post = buildVotePost(makeInput({ includePlainLinkFallback: true }));
    expect(plainText(post)).toContain("Buttons not showing?");
  });

  it("surfaces duplicate organizations with their match reasons and invoice state", () => {
    const post = buildVotePost(
      makeInput({
        duplicates: [
          {
            id: "org-1",
            name: "Sock Rocket Inc.",
            email: "adam@sockrocket.ca",
            website: "https://sockrocket.ca",
            membershipStatus: "active",
            type: "Vendor Partner",
            matchReasons: ["contact email", "website (sockrocket.ca)"],
            hasOutstandingInvoice: true,
            hasPaidInvoice: false,
          },
        ],
      })
    );
    const body = plainText(post);
    expect(body).toContain("Possible duplicate");
    expect(body).toContain("Sock Rocket Inc.");
    expect(body).toContain("contact email, website (sockrocket.ca)");
    expect(body).toContain("has an outstanding invoice");
  });

  it("says nothing about duplicates when there are none", () => {
    expect(plainText(buildVotePost(makeInput()))).not.toContain("Possible duplicate");
  });

  it("uses only node types Circle is verified to render", () => {
    // `poll` is accepted with HTTP 200 and silently dropped — it must never appear.
    const allowed = new Set(["paragraph", "heading", "horizontalRule", "cta"]);
    for (const type of nodeTypes(buildVotePost(makeInput()))) {
      expect(allowed.has(type as string)).toBe(true);
    }
  });

  it("degrades gracefully on a sparse application", () => {
    const sparse = {
      company_name: "Minimal Co",
      contact_name: "A Person",
      contact_email: "a@example.com",
    } as PartnerApplicationData;

    const input = makeInput();
    input.application.data = sparse;
    input.application.paidAmountCents = null;

    const post = buildVotePost(input);
    expect(post.name).toBe("Partner application — Minimal Co");
    // Still asks the question and still offers all three buttons.
    expect(plainText(post)).toContain("Should we approve this partner?");
    expect(nodeTypes(post).filter((t) => t === "cta")).toHaveLength(3);
  });
});
