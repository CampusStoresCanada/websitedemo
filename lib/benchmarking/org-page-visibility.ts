import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Who may see a store's own benchmarking figures on its org page.
 *
 * Three rules, and none of them lived here before: two were enforced only in
 * the browser and one was enforced nowhere.
 *
 * RECIPROCITY. Only a member who filed sees another member's figures. That gate
 * existed in ProtectedSection, which is a client component — so the financials
 * were serialised into every viewer's page payload and merely not painted. A
 * member who never filed could read another store's net profit out of view
 * source. Deciding it on the server means the numbers are not sent at all.
 *
 * DISCLOSURE. A store that chose aggregate-only is not named with its own line
 * items. That promise was kept in the comparison view, through resolveCut, and
 * ignored here — the org page predates the choice and never learned about it.
 * Nobody has chosen aggregate-only yet only because the control ships with the
 * October cycle; the first store to use it would have found the promise broken.
 *
 * RECIPROCITY OF THE CHOICE. A store that withholds its own detail does not
 * receive others' detail. Same rule resolveCut already applies, restated here
 * rather than imported, because this path has no cut to resolve.
 */

export type BenchmarkingVisibility =
  | { show: "detail" }
  | { show: "aggregate"; reason: string }
  | { show: "none"; reason: string };

export interface OrgPageVisibilityInput {
  /** The store being looked at. */
  targetDisclosureLevel: string | null | undefined;
  /** Did the viewer's own org file a survey? */
  viewerFiled: boolean;
  /** The viewer's own disclosure choice, for reciprocity. */
  viewerDisclosureLevel: string | null | undefined;
  /** Viewer is looking at their own store. */
  isOwnOrg: boolean;
  /** CSC staff. */
  isStaff: boolean;
}

const AGGREGATE_ONLY = "aggregate_only";

/** Said the same way wherever a non-participant is turned away. */
export const NOT_PARTICIPATING_REASON =
  "Results are exchanged between the stores that take part. File this year's " +
  "survey and your comparisons open up.";

/**
 * Pure so the rule can be read and tested without a database — this decides
 * what leaves the server, so it should not be buried in a query.
 */
export function resolveOrgPageBenchmarking(
  input: OrgPageVisibilityInput,
): BenchmarkingVisibility {
  // A store always sees its own figures exactly as filed, and staff need the
  // truth to do the job. Neither is a disclosure decision.
  if (input.isOwnOrg || input.isStaff) return { show: "detail" };

  // The viewer's own rung on the ladder. Derived by resultsTierFor(), never here
  // — this function used to answer it inline and the compare page answered it
  // again, differently.
  const tier = resultsTierFor({
    filed: input.viewerFiled,
    disclosureLevel: input.viewerDisclosureLevel ?? null,
  });

  if (tier === "none") {
    return { show: "none", reason: NOT_PARTICIPATING_REASON };
  }

  if (input.targetDisclosureLevel === AGGREGATE_ONLY) {
    return {
      show: "aggregate",
      reason:
        "This store asked to count toward the group figures without being named " +
        "individually. Their numbers are in the comparisons — just not on this page.",
    };
  }

  if (tier === "aggregate") {
    return {
      show: "aggregate",
      reason:
        "Your store is set to count toward the group figures without being named. " +
        "Named detail works both ways, so you see the comparisons rather than " +
        "individual stores. You can change this on your submission at any time.",
    };
  }

  return { show: "detail" };
}

/**
 * The viewer's own filing status and disclosure choice.
 *
 * Reads the newest year the viewer filed rather than a fixed year: someone who
 * took part last year has kept faith with the exchange even before this year's
 * cycle closes, and locking them out mid-cycle would punish them for the
 * calendar.
 */
export async function loadViewerBenchmarkingStanding(
  viewerOrgIds: string[],
  /**
   * The year whose results are being shown. Entitlement is per year: FY2026
   * results are bought by filing FY2026, and a store that filed in 2025 and
   * skipped 2026 is a non-participant in 2026. Omit to take the newest year
   * they have filed, which is what the org page does when no year is in play.
   */
  fiscalYear?: number | null,
): Promise<ViewerStanding> {
  if (viewerOrgIds.length === 0) return { filed: false, disclosureLevel: null };

  const db = createAdminClient();
  let q = db
    .from("benchmarking")
    .select("disclosure_level, fiscal_year")
    .in("organization_id", viewerOrgIds)
    .neq("status", "draft");

  if (typeof fiscalYear === "number") q = q.eq("fiscal_year", fiscalYear);

  const { data } = await q.order("fiscal_year", { ascending: false }).limit(1);

  const row = data?.[0];
  if (!row) return { filed: false, disclosureLevel: null };
  return { filed: true, disclosureLevel: (row.disclosure_level as string) ?? null };
}

export interface ViewerStanding {
  filed: boolean;
  disclosureLevel: string | null;
}

/** What a viewer is entitled to get back. */
export type ResultsTier = "none" | "aggregate" | "full";

/**
 * The ladder, in ONE place.
 *
 *   did not file            → none      (not a median, not a count)
 *   filed as aggregate_only → aggregate
 *   filed as full           → full
 *
 * It lives here because the two surfaces that answer this question — the org
 * page and /benchmarking/compare — had each derived it independently, and both
 * had settled on the same wrong floor: a non-participant was shown the group's
 * figures with a note inviting them to take part. The compare page said it out
 * loud, "You can still see how the group looks."
 *
 * ⛔ Anything that decides how much of the results someone gets calls this. A
 * third derivation is the bug, not a new feature.
 */
export function resultsTierFor(standing: ViewerStanding): ResultsTier {
  if (!standing.filed) return "none";
  return standing.disclosureLevel === AGGREGATE_ONLY ? "aggregate" : "full";
}

/**
 * The fields the org-page peer table actually reads.
 *
 * Everything else on a benchmarking row — the full sales breakdown, marketing
 * spend, rent — was being serialised into every org page for all 39 stores
 * because the whole row was passed through. Sending only what renders is the
 * difference between a table of ratios and a copy of everyone's books.
 */
const PEER_FIELDS = [
  "organization_id",
  "fiscal_year",
  "enrollment_fte",
  "institution_type",
  // Drives the "Mandate" peer-group tab — filters the set and labels the tab.
  // Missed on the first pass because the field list was guessed rather than
  // read off the component, which would have broken that tab silently.
  "operations_mandate",
  "total_square_footage",
  "total_gross_sales_instore",
  "total_online_sales",
  "total_cogs",
  "net_profit",
  "expense_hr",
] as const;

export interface PeerRowInput {
  organization_id: string;
  disclosure_level?: string | null;
  organization?: { id: string; name: string; slug?: string; is_test?: boolean } | null;
  [key: string]: unknown;
}

/**
 * Reduce the peer set to what may leave the server.
 *
 * `nameThem` false strips every store's identity — used when the viewer has
 * not filed, or has withheld their own detail. The rows stay so the shape of
 * the group is still readable, which is the whole promise of aggregate-only:
 * your figures count either way.
 *
 * A store that chose aggregate-only loses its name for everyone regardless,
 * while keeping its row in the set so it still counts toward the middle.
 */
export function projectPeerRows<T extends PeerRowInput>(
  rows: T[],
  opts: { nameThem: boolean; viewerOrgIds: string[] },
): Record<string, unknown>[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const f of PEER_FIELDS) out[f] = row[f];

    const isOwn = opts.viewerOrgIds.includes(row.organization_id);
    const optedOut = row.disclosure_level === AGGREGATE_ONLY;
    // A store always recognises itself in the table, even when it has asked
    // everyone else not to name it.
    const mayName = isOwn || (opts.nameThem && !optedOut);

    out.organization = mayName && row.organization
      ? { id: row.organization.id, name: row.organization.name, slug: row.organization.slug }
      : null;
    return out;
  });
}

/**
 * May this viewer receive the peer set at all?
 *
 * Separate from the disclosure rules above, and checked first, because those
 * ask "how much detail" while this asks "are they inside the exchange".
 *
 * A logged-out visitor is not a member who failed to file — they are not a
 * member. Treating them as an unnamed-aggregate case put 39 stores' net
 * profit, cost of goods and payroll into a public page as unattributed rows.
 * Unattributed is not anonymous: enrolment and square footage travel in the
 * same payload, and between them they identify most of the membership.
 *
 * This surface reads with the service role, so RLS is not the backstop here
 * and cannot be. This function is.
 */
export function mayReceivePeerSet(
  viewerLevel: string | null | undefined,
  viewerOrgIds: string[],
  viewerIsMemberStore: boolean,
): boolean {
  if (viewerLevel === "admin" || viewerLevel === "super_admin") return true;

  /*
    Membership in the EXCHANGE, not merely in an organisation.

    This used to read `viewerOrgIds.length > 0 && viewerLevel !== "public"`,
    which is satisfied by any logged-in account attached to any org. 295
    accounts across 123 Vendor Partner orgs clear that bar, and a partner
    opening any member store's page received the whole financial peer table —
    sales, COGS, net profit and payroll for every filing store — while the
    survey's own trust page promised "it is never shared with vendor partners".

    Nothing leaves the participating group without consent, aggregates included.
    So the question is whether the viewer's own org is a member store.
  */
  if (!viewerIsMemberStore) return false;

  return viewerOrgIds.length > 0 && viewerLevel !== "public";
}
