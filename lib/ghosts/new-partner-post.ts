/**
 * Helpful Ghost's new-partner announcement composer.
 *
 * Turns an activated Vendor Partner into the Circle post members see. Pure —
 * no I/O — so it can be unit tested and previewed without touching Circle.
 *
 * Output is always a DRAFT. Nothing here publishes; a human reads it, edits
 * it, and approves it first. See `ghost_announcements.status`.
 *
 * Node vocabulary is limited to what Circle's API actually renders, verified
 * empirically: `heading`, `paragraph`, `text` (bold / link marks),
 * `horizontalRule`, `cta`. `poll` nodes are accepted with HTTP 200 and
 * silently discarded — see lib/board/vote-post.ts.
 *
 * VOICE — Helpful Ghost, not Butler. Butler states facts about the reader's
 * own situation ("we know"); Suggestion makes recommendations ("we're
 * suggesting"). This is neither: it is network news delivered as a concierge
 * would — warm, useful, and short. It does not editorialise about whether the
 * partner is any good.
 */

import { abbreviateProvince } from "@/lib/constants/provinces";

export type PMNode = Record<string, unknown>;

const text = (value: string, bold = false): PMNode =>
  bold ? { type: "text", text: value, marks: [{ type: "bold" }] } : { type: "text", text: value };

const link = (label: string, href: string): PMNode => ({
  type: "text",
  text: label,
  marks: [{ type: "link", attrs: { href, target: "_blank", rel: "noopener noreferrer nofollow" } }],
});

const para = (...content: PMNode[]): PMNode =>
  content.length ? { type: "paragraph", content } : { type: "paragraph" };

const rule = (): PMNode => ({ type: "horizontalRule" });

const cta = (label: string, url: string): PMNode => ({
  type: "cta",
  attrs: {
    url,
    label,
    color: "#B92026",
    text_color: "#FFFFFF",
    alignment: "center",
    full_width: false,
  },
});

const field = (label: string, ...value: PMNode[]): PMNode | null =>
  value.length ? para(text(`${label}: `, true), ...value) : null;

/** Display form of a URL — no protocol, no trailing slash. */
export function displayUrl(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

/** "Calgary, AB" — skips whichever half is missing. */
export function formatLocation(city?: string | null, province?: string | null): string {
  return [city?.trim(), abbreviateProvince(province)].filter(Boolean).join(", ");
}

export interface NewPartnerPostInput {
  organization: {
    name: string;
    slug: string;
    website?: string | null;
    city?: string | null;
    province?: string | null;
    primaryCategory?: string | null;
    /** Third-person summary derived from their site. Preferred for prose. */
    websiteSummary?: string | null;
    /** The partner's own copy — usually first person. Quoted, never narrated. */
    companyDescription?: string | null;
  };
  /** YYYY-MM-DD they became active. */
  joinedOn: string;
  /** Base URL for the profile link. */
  appUrl: string;
}

export interface NewPartnerPost {
  title: string;
  tiptap_body: { body: { type: "doc"; content: PMNode[] } };
}

export function buildNewPartnerPost(input: NewPartnerPostInput): NewPartnerPost {
  const org = input.organization;
  const name = org.name?.trim() || "A new partner";
  const profileUrl = `${input.appUrl.replace(/\/+$/, "")}/org/${org.slug}`;
  const content: PMNode[] = [];

  content.push(
    para(
      text(`${name} has joined Campus Stores Canada as a Vendor Partner. Here's a quick introduction.`)
    )
  );

  // Prose comes from the third-person summary. The partner's own copy is
  // first person ("Hello! We are…"), which would read as the ghost claiming to
  // be them — so when that is all we have, it is quoted and attributed instead
  // of narrated.
  const summary = org.websiteSummary?.trim();
  const ownWords = org.companyDescription?.trim();

  if (summary) {
    content.push(para(text(summary)));
  } else if (ownWords) {
    content.push(para(text("In their own words:", true)), para(text(`“${ownWords}”`)));
  }

  const details: (PMNode | null)[] = [
    org.primaryCategory?.trim() ? field("Category", text(org.primaryCategory.trim())) : null,
    formatLocation(org.city, org.province)
      ? field("Based in", text(formatLocation(org.city, org.province)))
      : null,
    org.website?.trim()
      ? field("Website", link(displayUrl(org.website), org.website.trim()))
      : null,
  ];
  content.push(...(details.filter(Boolean) as PMNode[]));

  content.push(rule());
  content.push(cta(`View ${name}`, profileUrl));

  return {
    title: `Welcome, ${name}`,
    tiptap_body: { body: { type: "doc", content } },
  };
}
