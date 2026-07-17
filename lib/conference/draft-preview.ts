/**
 * Orgs allowed to view a draft (unpublished) conference alongside the
 * existing global-admin override. Dedicated test orgs only — see
 * components/dev/DevPanel.tsx for the matching login credentials.
 */
const DRAFT_PREVIEW_ORG_IDS: readonly string[] = [
  "032862cf-1b39-4911-93cc-e1fdc13df741", // Test Org (Public Tier)
  "1a5e240b-bf97-4534-93d5-b9b4cfe15bb3", // Test Org (Partner)
  "f7b3fee0-339f-404a-b77d-ec95f40e8f89", // Test Org (Member)
];

export function hasDraftPreviewAccess(orgIds: readonly string[]): boolean {
  // A genuinely anonymous visitor (no session, no org) is exactly who the
  // public conference pages need to be tested as — but every draft
  // conference has always required logging in as one of the orgs above just
  // to see the page at all, which meant "test as a rando off the internet"
  // was never actually possible without first authenticating. NODE_ENV is
  // set by Next.js itself (never by a .env file) — "development" only under
  // `next dev`, always "production" for `next build`/any Vercel deployment —
  // so this can't leak into anything actually deployed.
  if (process.env.NODE_ENV !== "production") return true;
  return orgIds.some((id) => DRAFT_PREVIEW_ORG_IDS.includes(id));
}
