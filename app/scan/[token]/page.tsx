import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOptionalAuthContext } from "@/lib/auth/guards";
import {
  classifyScan,
  findExistingScan,
  orgPageResolves,
  resolveScanToken,
  resolveScanner,
} from "@/lib/conference/badges/scan";
import { ScanCaptured } from "@/components/scan/ScanCaptured";
import { confirmBadgeScan, recordOrgScan } from "@/lib/actions/badge-scan";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Badge scan | Campus Stores Canada",
  robots: { index: false },
};

/**
 * What a phone opens when it scans a conference badge.
 *
 * ⛔ This is a GET and it therefore RECORDS NOTHING. It resolves who is
 * scanning and who was scanned, then shows what would happen and asks. The
 * write is a server action behind a button — see lib/actions/badge-scan.ts.
 */
export default async function BadgeScanPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // ⛔ Auth FIRST, before the token is looked up.
  //
  // Anonymous traffic must not reach the database at all. This URL is printed
  // on a badge and will end up crawled, shared and retried; without this the
  // route would happily serve an indexed read per hit forever. Nothing is
  // written either way — the mutation is far below — but "writes nothing" is
  // not the same as "costs nothing".
  //
  // The trade, deliberately accepted: someone who mistypes a code now signs in
  // before being told the code is bad. Telling a stranger which codes are real
  // was never worth a free lookup oracle anyway.
  const ctx = await getOptionalAuthContext();
  if (!ctx) {
    redirect(`/login?next=${encodeURIComponent(`/scan/${token}`)}`);
  }

  const badge = await resolveScanToken(token);
  if (!badge) {
    return (
      <Shell title="That badge code isn't valid">
        <p className="text-slate-600">
          It may have been reissued, or the code may have been mistyped. The desk can print a
          replacement badge.
        </p>
      </Shell>
    );
  }

  const scanner = await resolveScanner(ctx.userId);
  const outcome = await classifyScan(scanner, badge);

  // Scanning your own badge records nothing: there is no second party, so no
  // relationship to observe and nothing for scoring to learn.
  if (outcome === "map") {
    redirect(
      badge.conferenceYear && badge.conferenceEdition
        ? `/conference/${badge.conferenceYear}/${badge.conferenceEdition}/map`
        : "/me"
    );
  }

  // Vendor capturing a member.
  //
  // ⛔ The scan ITSELF is the capture — there is no confirm tap. A vendor who
  // pointed their camera at a badge has already said what they want, and a
  // second tap only loses captures when they walk away. This is safe to do on a
  // GET here for two specific reasons: the route requires a session, so no link
  // scanner or mail security product can reach it; and the capture DISCLOSES
  // NOTHING — it queues a request the member decides on afterwards, which is
  // the entire point of deferred consent. `confirmBadgeScan` is idempotent, so
  // re-scanning the same badge does not ask the member twice.
  if (outcome === "capture") {
    await confirmBadgeScan(token);
    const existing = await findExistingScan(scanner.userId, badge);
    const name = badge.displayName?.trim() || "This attendee";
    return (
      <Shell title={name}>
        {badge.organizationName ? (
          <p className="text-slate-600">{badge.organizationName}</p>
        ) : null}
        <div className="mt-6">
          <ScanCaptured
            personName={name}
            disclosureStatus={existing?.disclosureStatus ?? null}
          />
        </div>
      </Shell>
    );
  }

  // Everything else is a redirect to somewhere that already exists. Which
  // direction lands on which of these is the CONFERENCE's choice — see
  // BadgeScanRulesEditor — so a conference with no community sends peer scans
  // to `org` rather than dead-ending at a Circle profile that does not exist.
  //   `circle` → /api/circle/profile/[contactId], which mints a member token,
  //              resolves public_uid and lands on ${COMMUNITY_URL}/u/<uid>.
  //   `org`    → /org/<slug>, MemberProfile or PartnerProfile, masked by viewer.
  //   `none`   → deliberately nothing; falls through to the card below.
  const orgLanding =
    badge.organizationSlug && orgPageResolves(badge.organizationMembershipStatus)
      ? `/org/${badge.organizationSlug}?s=b`
      : null;

  if (outcome === "circle" && badge.contactId) {
    await recordOrgScan(scanner, badge);
    redirect(`/api/circle/profile/${badge.contactId}`);
  }

  if (orgLanding) {
    await recordOrgScan(scanner, badge);
    redirect(orgLanding);
  }

  // Nowhere to send them. ⛔ Do NOT 404 here: the person whose badge was just
  // scanned is standing right there, and "not found" reads as though they made
  // themselves up. Name them so they are visibly real, say the listing is not
  // ready, and let the scanner do the nudging — a request from the person in
  // front of you lands harder than any email we could send.
  await recordOrgScan(scanner, badge);
  return (
    <Shell title={badge.displayName?.trim() || "This attendee"}>
      {badge.organizationName ? (
        <p className="text-slate-600">{badge.organizationName}</p>
      ) : null}
      <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p className="font-medium text-slate-900">Their page isn&apos;t up yet</p>
        <p className="mt-1 text-sm text-slate-700">
          {badge.organizationName ?? "Their organisation"} hasn&apos;t finished setting up
          their listing, so there&apos;s nothing here to show you yet.
        </p>
        <p className="mt-3 text-sm text-slate-700">
          They&apos;re standing right in front of you — ask them to finish it.
        </p>
      </div>
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-12">
      <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
      <div className="mt-2">{children}</div>
    </main>
  );
}
