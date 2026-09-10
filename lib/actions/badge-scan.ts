"use server";

/**
 * Badge scan actions.
 *
 * ⛔ Everything here MUTATES, so everything here is a POST. Opening
 * `/scan/<token>` must never create a scan or queue a disclosure: link scanners,
 * chat unfurlers and mail security products fetch URLs unbidden — Safe Links
 * pre-clicks every URL in an email — and a lead that a crawler invented is
 * indistinguishable from one a person meant.
 *
 * ⛔⛔ THE SIGNAL ROW IS A POINTER. `conference_badge_scans` IS THE EVIDENCE.
 *
 * Every `recordAct()` below writes to `signal_inbox`, which carries no
 * provenance — no scheduled-vs-organic, no outcome, nothing about how the two
 * people came to be standing together. Anything that trains on inbox rows
 * directly therefore reads an engineered encounter and a chance one as
 * identical, which is the exact contamination the scoring work keeps hitting.
 *
 * `conference_badge_scans` is the authoritative record and is where provenance
 * lives. A consumer that cares about a scan must join back to it rather than
 * trust the inbox payload. Agreed with the match-scoring session 2026-09-03;
 * nothing in this repo reads `signal_inbox` except its own depth counters.
 */

import { revalidatePath } from "next/cache";
import { getOptionalAuthContext } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAct } from "@/lib/signals/inbox";
import { butlerDm, dmLink, dmPara, dmText } from "@/lib/ghosts/butler-dm";
import {
  classifyScan,
  findExistingScan,
  recordBadgeScan,
  resolveScanToken,
  resolveScanner,
  type ScannedBadge,
  type Scanner,
  type ScanOutcome,
} from "@/lib/conference/badges/scan";

export type ScanActionResult =
  | { ok: true; outcome: ScanOutcome; alreadyRecorded: boolean }
  | { ok: false; error: string };

function consentUrl(): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "https://campusstores.ca").replace(/\/+$/, "");
  return `${base}/scan/consent`;
}

/**
 * Tell the member a vendor scanned them, and that nothing has been shared yet.
 *
 * The DM links to the consent page rather than carrying yes/no links of its
 * own: a link is a GET, and the decision must not be answerable by anything
 * that merely fetches a URL. Nothing reads replies to Butler either, so the
 * decision has to happen on a page.
 */
async function notifyMemberOfPendingDisclosure(params: {
  memberEmail: string | null;
  memberFirstName: string | null;
  vendorName: string | null;
}): Promise<void> {
  const { memberEmail, memberFirstName, vendorName } = params;
  if (!memberEmail) return;

  const who = vendorName ?? "An exhibitor";
  const greeting = memberFirstName ? `${memberFirstName}, someone` : "Someone";

  await butlerDm(
    memberEmail,
    [
      dmPara(dmText("Someone scanned your badge.", true)),
      dmPara(
        dmText(
          `${greeting} scanned your badge at the conference — ${who} would like your contact details so they can follow up.`
        )
      ),
      dmPara(dmText("Nothing has been sent. It sits in their queue until you say so.")),
      dmPara(dmLink("Choose who gets your details", consentUrl())),
      dmPara(
        dmText(
          "I am not a smart ghost. If you send me a paragraph I will read it, understand none of it, and continue to stand here. Use the link."
        )
      ),
    ],
    `${who} scanned your badge and would like your contact details. Nothing has been sent yet — decide at ${consentUrl()}`
  );
}

/**
 * Record a scan the viewer has explicitly confirmed.
 */
export async function confirmBadgeScan(token: string): Promise<ScanActionResult> {
  const ctx = await getOptionalAuthContext();
  if (!ctx) return { ok: false, error: "You need to be signed in to scan a badge." };

  const badge = await resolveScanToken(token);
  if (!badge) return { ok: false, error: "That badge code is not valid." };

  const scanner = await resolveScanner(ctx.userId);
  const outcome = await classifyScan(scanner, badge);
  // Scanning your own badge has no second party to record.
  if (outcome === "map" || outcome === "none") {
    return { ok: true, outcome, alreadyRecorded: false };
  }

  // A second tap on the same badge should not queue a second consent request:
  // the member would be asked twice about one conversation.
  const existing = await findExistingScan(scanner.userId, badge);
  if (existing) return { ok: true, outcome, alreadyRecorded: true };

  const { disclosureId } = await recordBadgeScan({ scanner, badge, outcome });

  if (disclosureId) {
    const db = createAdminClient();
    const { data: person } = await db
      .from("conference_people")
      .select("contact_email, display_name")
      .eq("id", badge.personId)
      .maybeSingle();
    const displayName = (person?.display_name as string | null) ?? null;
    await notifyMemberOfPendingDisclosure({
      memberEmail: (person?.contact_email as string | null) ?? null,
      memberFirstName: displayName ? displayName.trim().split(/\s+/)[0] : null,
      vendorName: scanner.organizationName,
    });
  }

  // The spine already has `verb: "scanned"` and `source: "conference"` in its
  // vocabulary — it was built expecting this producer. A scan IS the follow-up
  // intent signal: we do not know WHY someone scanned, only that they want to
  // follow up, which is exactly the act the scoring engine should see.
  //
  // ⛔ `void` deliberately. recordAct's result distinguishes queued from
  // duplicate, and returning that to a client turns this route into an oracle
  // for whether a given act already happened.
  void recordAct({
    source: "conference",
    verb: "scanned",
    objectType: "org",
    objectOrgId: badge.organizationId,
    objectRef: badge.personId,
    // Keyed on the act, not the object. recordAct prefixes the acting org.
    dedupeKey: `conference:scan:${badge.personId}`,
  });

  revalidatePath("/scan/leads");
  revalidatePath("/scan/consent");
  return { ok: true, outcome, alreadyRecorded: false };
}

/**
 * Record a scan that is on its way to an organisation's page.
 *
 * No confirmation step, because nothing is disclosed: the scanner is about to
 * see a page they could already reach, masked to their own ViewerLevel. The act
 * is still recorded — "a member is free to scan and is only tracked by us" —
 * and still emitted as signal, because wanting to look someone up IS the
 * follow-up intent the scoring engine should see.
 *
 * ⚠️ This runs during a GET, unlike every other write here. That is deliberate
 * and matches `recordDirectoryScan` on the printed-directory page: it creates
 * no lead, discloses nothing, and the route is behind a session, so a crawler
 * cannot reach it. Re-scanning the same badge does not add a second row.
 */
export async function recordOrgScan(
  scanner: Scanner,
  badge: ScannedBadge
): Promise<void> {
  try {
    const existing = await findExistingScan(scanner.userId, badge);
    if (!existing) {
      await recordBadgeScan({ scanner, badge, outcome: "org" });
    }
    void recordAct({
      source: "conference",
      verb: "scanned",
      objectType: "org",
      objectOrgId: badge.organizationId,
      objectRef: badge.personId,
      dedupeKey: `conference:scan:${badge.personId}`,
    });
  } catch {
    // Never block the redirect. Losing one tracking row is preferable to
    // stranding someone who just scanned a badge on an error page.
  }
}

/**
 * The member's decision on one queued disclosure.
 *
 * Authorisation is the point: only the person whose details would be disclosed
 * may decide, so the disclosure is matched against the caller's own contacts
 * rather than trusted from the id in the request.
 */
export async function decideLeadDisclosure(
  disclosureId: string,
  decision: "released" | "declined"
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await getOptionalAuthContext();
  if (!ctx) return { ok: false, error: "You need to be signed in." };

  const db = createAdminClient();
  const { data: disclosure } = await db
    .from("conference_lead_disclosures")
    .select("id, status, member_person_id, vendor_organization_id")
    .eq("id", disclosureId)
    .maybeSingle();
  if (!disclosure) return { ok: false, error: "That request no longer exists." };
  if (disclosure.status !== "pending") {
    return { ok: false, error: "That request has already been decided." };
  }

  const { data: contacts } = await db.from("contacts").select("id").eq("profile_id", ctx.userId);
  const mine = new Set((contacts ?? []).map((c) => c.id as string));
  const { data: person } = await db
    .from("conference_people")
    .select("contact_id, canonical_person_id")
    .eq("id", disclosure.member_person_id as string)
    .maybeSingle();
  const isMine =
    (typeof person?.contact_id === "string" && mine.has(person.contact_id)) ||
    (typeof person?.canonical_person_id === "string" && mine.has(person.canonical_person_id));
  if (!isMine) return { ok: false, error: "That request is not yours to decide." };

  const { error } = await db
    .from("conference_lead_disclosures")
    .update({ status: decision, decided_at: new Date().toISOString(), decided_by: ctx.userId })
    .eq("id", disclosureId)
    .eq("status", "pending");
  if (error) return { ok: false, error: `Could not save that: ${error.message}` };

  // ⛔ RELEASE ONLY. A decline is deliberately silent.
  //
  // Releasing is the strongest positive act anywhere in the conference: a named
  // person deciding, unprompted and after the fact, that one specific company
  // may have their contact details. That is `explicit` in the spine's sense —
  // and until now NOTHING in this application emitted an explicit verb at all,
  // so the whole high-quality tier had no producer.
  //
  // `selected` rather than `preferred`: the consent page shows every exhibitor
  // who scanned them and they choose among those alternatives, which is exactly
  // what `selected` describes. `preferred` is a ranked top-N pick, which this
  // is not. Whoever owns the scoring engine can overrule the verb; the act is
  // what matters here.
  //
  // ⛔ The DECLINE is NOT emitted, on purpose. "I would rather not hand this
  // vendor my email" is not "I refuse to meet this company" — conflating them
  // would feed the blackout system something far weaker than a blackout, and
  // refusals are a FILTER that must decay, never a score. That call belongs to
  // the matching session, not here.
  if (decision === "released" && disclosure.vendor_organization_id) {
    void recordAct({
      source: "conference",
      verb: "selected",
      objectType: "org",
      objectOrgId: disclosure.vendor_organization_id as string,
      // One release per disclosure, permanent — inbox rows are deleted on drain,
      // so the key must stay stable rather than being window-relative.
      dedupeKey: `conference:lead-release:${disclosureId}`,
    });
  }

  revalidatePath("/scan/consent");
  revalidatePath("/scan/leads");
  return { ok: true };
}
