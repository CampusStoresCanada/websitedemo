// Read at send time by lib/email (layout.ts, send.ts). Server-only, no auth:
// getActiveSponsors is the public reader the homepage and Partners page use.
import { getActiveSponsors } from "@/lib/actions/sponsorship";
import { sponsorsInSlot, type SponsorInSlot } from "./types";

/**
 * The slot a sponsor's email presence fills. The email_brand_presence benefit
 * puts up a placement in both email_header and email_footer; the layout shows
 * one block, above the legal footer, so it reads the footer slot.
 */
export const EMAIL_SPONSOR_SLOT = "email_footer";

/**
 * The sponsors to thank at the bottom of a commercial email, today.
 *
 * Never throws: a sponsor lookup failing must not stop an email going out, it
 * just goes out without the block. Sponsors with no logo are left off, since
 * the block is a row of logos.
 */
export async function loadEmailSponsors(): Promise<SponsorInSlot[]> {
  try {
    const result = await getActiveSponsors();
    if (!result.success) return [];
    return sponsorsInSlot(result.data, EMAIL_SPONSOR_SLOT).filter((s) => !!s.logoUrl);
  } catch (err) {
    console.error("[email] sponsor lookup failed; sending without the sponsor block:", err);
    return [];
  }
}
