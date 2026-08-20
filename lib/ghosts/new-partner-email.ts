/**
 * The member-facing email that accompanies a new-partner announcement.
 *
 * Pure — no I/O, no send infrastructure — so it can be unit tested without a
 * Resend key, and so importing it never risks a side effect. The preparation
 * step that turns this into a draft campaign lives in announcement-email.ts.
 *
 * Deliberately short. The Circle post carries the detail; this exists for
 * members who don't open Circle, and its job is to get them to the profile.
 */

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://campusstores.ca";

export interface AnnouncementEmailInput {
  organizationName: string;
  organizationSlug: string;
  /** The prose already reviewed and approved for the Circle post. */
  summaryText: string;
  /** Link to the published Circle post, when there is one. */
  circlePostUrl?: string | null;
  category?: string | null;
  location?: string | null;
}

export function buildAnnouncementEmail(input: AnnouncementEmailInput): {
  subject: string;
  bodyHtml: string;
} {
  const profileUrl = `${APP_URL.replace(/\/+$/, "")}/org/${input.organizationSlug}`;
  const facts = [input.category, input.location].filter(Boolean).join(" · ");

  // Trimmed to a couple of sentences — the full write-up lives on the post and
  // the profile, and a long email just delays the click.
  const shortSummary = firstSentences(input.summaryText, 2);

  const bodyHtml = `
<p>${escapeHtml(input.organizationName)} has joined Campus Stores Canada as a Vendor Partner.</p>
${shortSummary ? `<p>${escapeHtml(shortSummary)}</p>` : ""}
${facts ? `<p><strong>${escapeHtml(facts)}</strong></p>` : ""}
<p><a href="${profileUrl}">See their profile →</a></p>
${
  input.circlePostUrl
    ? `<p style="color:#6b7280;font-size:14px">There's more about them, and somewhere to ask questions, <a href="${input.circlePostUrl}">over in the community</a>.</p>`
    : ""
}
`.trim();

  return {
    subject: `New CSC partner: ${input.organizationName}`,
    bodyHtml,
  };
}

/** First N sentences, so a long scraped summary doesn't become a long email. */
function firstSentences(text: string | null | undefined, count: number): string {
  if (!text?.trim()) return "";
  const parts = text.trim().match(/[^.!?]+[.!?]+(\s|$)/g);
  if (!parts?.length) return text.trim();
  return parts.slice(0, count).join("").trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
