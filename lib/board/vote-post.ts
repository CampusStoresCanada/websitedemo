/**
 * Butler Ghost's board-vote post composer.
 *
 * Turns a partner `signup_applications` row into the Circle post body the board
 * votes on. Pure — no I/O, no Circle calls — so it can be unit tested and
 * previewed without touching the community.
 *
 * Node vocabulary is limited to what Circle's API actually renders, verified
 * empirically 2026-08-19: `heading`, `paragraph`, `text` (bold / link marks),
 * `horizontalRule`, and `cta`. NOTE: `poll` nodes are accepted with HTTP 200
 * and silently discarded — Circle cannot create polls via any API, which is
 * why the vote is CTA buttons rather than a native poll.
 *
 * Voice: Butler states facts, never speculates (the "we know" contract). The
 * post reports what the application says and what our own duplicate check
 * found; it does not editorialise about the applicant.
 */

import { formatCents } from "@/lib/utils";
import { abbreviateProvince } from "@/lib/constants/provinces";
import type { PartnerApplicationData, DuplicateOrgMatch } from "@/lib/actions/applications";

// ─── tiptap node builders ─────────────────────────────────────────────────────

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

const heading = (level: number, value: string): PMNode => ({
  type: "heading",
  attrs: { level },
  content: [text(value)],
});

const rule = (): PMNode => ({ type: "horizontalRule" });

const cta = (label: string, url: string, color: string): PMNode => ({
  type: "cta",
  attrs: {
    url,
    label,
    color,
    text_color: "#FFFFFF",
    alignment: "center",
    full_width: false,
  },
});

/** A labelled detail line: "**Website:** value". Omitted entirely when empty. */
const field = (label: string, ...value: PMNode[]): PMNode | null =>
  value.length ? para(text(`${label}: `, true), ...value) : null;

// ─── Brand palette ────────────────────────────────────────────────────────────

const CSC_RED = "#B92026";
const NEUTRAL_DARK = "#2B2E33";
const NEUTRAL_GREY = "#6B7280";

// ─── Formatting helpers ───────────────────────────────────────────────────────

/**
 * "6479838862" → "(647) 983-8862". Handles a leading country code. Anything
 * that isn't a recognisable NANP number is returned as-is rather than mangled.
 *
 * Local to this module on purpose: `lib/utils.ts` exports a `formatPhone` that
 * is currently a pass-through stub, and changing it would reach every caller.
 */
export function formatPhoneNumber(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (local.length !== 10) return raw.trim();
  return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
}

/** Display form of a URL — no protocol, no trailing slash. Href keeps the original. */
export function displayUrl(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

/** Normalised for comparison, so a duplicate of the website can be suppressed. */
function urlKey(raw: string | null | undefined): string {
  return displayUrl(raw).toLowerCase().replace(/^www\./, "");
}

/** "1212 34 Ave SE, Calgary, AB T2G 1V7" — skips whichever parts are missing. */
export function formatLocation(d: PartnerApplicationData): string {
  const region = [abbreviateProvince(d.province), d.postal_code?.trim()].filter(Boolean).join(" ");
  return [d.street_address?.trim(), d.city?.trim(), region].filter(Boolean).join(", ");
}

/** "General Merchandise: Apparel & Spirit Wear, Gifts & Collectibles" */
export function formatCategories(d: PartnerApplicationData): string {
  const secondary = (d.secondary_categories ?? []).filter(Boolean);
  if (!d.primary_category) return secondary.join(", ");
  return secondary.length ? `${d.primary_category}: ${secondary.join(", ")}` : d.primary_category;
}

// ─── Input ────────────────────────────────────────────────────────────────────

export interface VotePostInput {
  application: {
    id: string;
    data: PartnerApplicationData;
    /** Set when the applicant already paid for a booth ahead of approval. */
    paidAmountCents?: number | null;
    paidFor?: string | null;
  };
  /** Output of the existing duplicate-org check. Empty array when clean. */
  duplicates: DuplicateOrgMatch[];
  vote: {
    /** Shared across all directors — the route identifies the voter by session. */
    urls: { yes: string; no: string; abstain: string };
    /** Pre-formatted in the board's civil time, e.g. "Friday, August 22 at 5:00 PM ET". */
    closesAtLabel: string;
    threshold: number;
    boardSize: number;
  };
  /** Deep link to the full application in the admin UI. */
  adminUrl: string;
  /**
   * Emit plain-text vote links beneath the buttons.
   *
   * Defaults false. Circle's `circle_ios_fallback_text` omits CTA labels, which
   * looked like a mobile-rendering risk — but the buttons were confirmed working
   * in the Circle iOS app on 2026-08-19, so the fallback line is redundant. The
   * flag stays as a one-line recovery if Circle's rendering ever regresses.
   */
  includePlainLinkFallback?: boolean;
}

export interface VotePost {
  name: string;
  tiptap_body: { body: { type: "doc"; content: PMNode[] } };
}

// ─── Composer ─────────────────────────────────────────────────────────────────

export function buildVotePost(input: VotePostInput): VotePost {
  const { application, duplicates, vote, adminUrl } = input;
  const d = application.data;
  const withFallback = input.includePlainLinkFallback ?? false;

  const company = d.company_name?.trim() || "Unnamed applicant";
  const content: PMNode[] = [];

  // Butler's framing — what this is and what is being asked.
  content.push(
    para(
      text(
        `A new Vendor Partner application is ready for the board. ${vote.threshold} of ${vote.boardSize} votes in favour approves it. Voting closes ${vote.closesAtLabel}.`
      )
    )
  );

  content.push(heading(2, company));

  const details: (PMNode | null)[] = [
    d.website ? field("Website", link(displayUrl(d.website), d.website)) : null,
    field(
      "Contact",
      text(
        [d.contact_name?.trim(), d.contact_email?.trim(), formatPhoneNumber(d.phone)]
          .filter(Boolean)
          .join(" | ")
      )
    ),
    formatLocation(d) ? field("Location", text(formatLocation(d))) : null,
    formatCategories(d) ? field("Categories", text(formatCategories(d))) : null,
  ];

  // Only show brand info when it says something the website line didn't.
  if (d.brand_info?.trim() && urlKey(d.brand_info) !== urlKey(d.website)) {
    details.push(
      field(
        "Brand info",
        /^https?:\/\//i.test(d.brand_info.trim())
          ? link(displayUrl(d.brand_info), d.brand_info.trim())
          : text(d.brand_info.trim())
      )
    );
  }

  if (application.paidAmountCents) {
    const what = application.paidFor === "booth" ? "booth" : (application.paidFor ?? "registration");
    details.push(field("Paid", text(`${formatCents(application.paidAmountCents)} for a ${what}`)));
  }

  content.push(...(details.filter(Boolean) as PMNode[]));

  if (d.company_description?.trim()) {
    content.push(para(text("Description:", true)), para(text(d.company_description.trim())));
  }

  // Our own duplicate check — information the board has never been shown before.
  if (duplicates.length) {
    content.push(para(text("⚠️ Possible duplicate of an existing organization:", true)));
    for (const dup of duplicates) {
      const flags = [
        dup.type,
        dup.membershipStatus,
        dup.hasPaidInvoice ? "has a paid invoice" : null,
        dup.hasOutstandingInvoice ? "has an outstanding invoice" : null,
      ].filter(Boolean);
      content.push(
        para(
          text(`• ${dup.name} — matched on ${dup.matchReasons.join(", ")}`),
          ...(flags.length ? [text(` (${flags.join(", ")})`)] : [])
        )
      );
    }
  }

  content.push(rule());
  content.push(para(text("Should we approve this partner?", true)));

  content.push(cta("Vote Yes", vote.urls.yes, CSC_RED));
  content.push(cta("Vote No", vote.urls.no, NEUTRAL_DARK));
  content.push(cta("Abstain", vote.urls.abstain, NEUTRAL_GREY));

  if (withFallback) {
    content.push(
      para(
        text("Buttons not showing? Vote here: "),
        link("Yes", vote.urls.yes),
        text(" · "),
        link("No", vote.urls.no),
        text(" · "),
        link("Abstain", vote.urls.abstain)
      )
    );
  }

  content.push(
    para(
      text(`Closes ${vote.closesAtLabel} · ${vote.threshold} of ${vote.boardSize} needed · `),
      link("View the full application", adminUrl)
    )
  );

  return {
    name: `Partner application — ${company}`,
    tiptap_body: { body: { type: "doc", content } },
  };
}
