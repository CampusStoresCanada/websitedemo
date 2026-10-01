import { redirect } from "next/navigation";
import { releasedFiscalYears } from "@/lib/benchmarking/release";
import { isGlobalAdmin, requireAuthenticated } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildCut,
  REGION_OF,
  type BenchmarkingRow,
  type ComparisonCut,
} from "@/lib/benchmarking/comparison";
import ComparisonView from "@/components/benchmarking/ComparisonView";
import AdminOrgSwitcher from "@/components/conference/AdminOrgSwitcher";
import { resolveActingOrg } from "@/lib/benchmarking/acting-org";
import { getSizeBands, resolveSizeBand } from "@/lib/benchmarking/size-band";
import { loginWithNext } from "@/lib/auth/login-redirect";
import {
  resultsTierFor,
  NOT_PARTICIPATING_REASON,
} from "@/lib/benchmarking/org-page-visibility";

export const metadata = {
  title: "How you compare | Campus Stores Canada",
  description: "Your store against comparable member stores.",
};

/**
 * The reader's own store against its peers.
 *
 * Every named peer on this page passed through resolveCut first. That is the
 * whole reason the page exists in this shape: the disclosure choice was a
 * promise with nothing enforcing it until something rendered peers, and the
 * safe way to render peers is to never build the list here.
 *
 * Reads the most recent year that HAS data, not the current cycle — for most of
 * this autumn that is 2025, and a comparison page that shows nothing until
 * December is a page nobody learns to use.
 */
export default async function BenchmarkingComparePage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const params = await searchParams;
  const auth = await requireAuthenticated();
  if (!auth.ok) redirect(loginWithNext("/benchmarking/compare"));

  const { supabase, userId, globalRole } = auth.ctx;
  const isAdmin = isGlobalAdmin(globalRole);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: userOrgs } = (await (supabase as any)
    .from("user_organizations")
    .select("organization_id, role, organization:organizations(id, name, type, province, fte)")
    .eq("user_id", userId)
    .eq("status", "active")) as { data: any[] | null };

  /*
    Same question, same function. This page carried its own copy of the org
    resolution with `isAdmin` on the role clause instead of the attachment one,
    so a CSC staffer resolved to nothing and was bounced to /benchmarking —
    the third page today with that exact bug.
  */
  const { data: latestSurveyRow } = await createAdminClient()
    .from("benchmarking_surveys")
    .select("id")
    .order("fiscal_year", { ascending: false })
    .limit(1)
    .maybeSingle();

  const acting = await resolveActingOrg({
    userOrgs: userOrgs ?? [],
    isAdmin,
    requestedOrgId: params?.org ?? null,
    surveyId: (latestSurveyRow?.id as string) ?? null,
  });

  const organization = acting.organization as
    | { id: string; name: string; province: string; fte: number | null }
    | null;

  if (!organization) {
    if (isAdmin && acting.adminOrgOptions.length > 0) {
      return (
        <div className="mx-auto max-w-3xl px-4 py-10">
          <h1 className="text-2xl font-bold text-gray-900">How you compare</h1>
          <p className="mt-2 text-sm text-gray-600">
            Pick the store whose comparisons you want to see. This page places one
            store against its peers, so it needs to know which one.
          </p>
          <div className="mt-5">
            <AdminOrgSwitcher
              orgs={acting.adminOrgOptions}
              selectedOrgId={null}
              basePath="/benchmarking/compare"
              label="compare as"
            />
          </div>
        </div>
      );
    }
    redirect("/benchmarking");
  }

  const db = createAdminClient();

  /*
    The newest year the committee has RELEASED, not the newest anyone has filed.

    ⛔ This asked for the newest non-draft row, so the first store to submit
    FY2026 flipped the whole association onto FY2026 — and the medians below
    were then built from every FY2026 row, which at that moment was that one
    store. Every member comparing themselves would have been measured against a
    single early filer, in a year nobody had reviewed.
  */
  const released = await releasedFiscalYears();
  const fiscalYear = released[0] ?? null;

  if (!fiscalYear) {
    return (
      <ComparisonView
        organizationName={organization.name}
        fiscalYear={null}
        cuts={[]}
        youFiled={false}
      />
    );
  }

  // A released year, and still never a draft inside it.
    /*
      ⛔ Test organisations are not part of anybody's cohort.

      This pooled every non-draft row for the year, and a test store's row is
      non-draft like any other — so a scratch submission written while walking
      the survey sat in the medians real stores are compared against. Nothing
      about it is visible downstream: it is one more row in a percentile.
    */
  const { data: rowsRaw } = await db
    .from("benchmarking")
    .select("*, organizations!inner(is_test)")
    .eq("fiscal_year", fiscalYear)
    .not("status", "eq", "draft")
    .not("organizations.is_test", "is", true);

  const rows = (rowsRaw ?? []) as unknown as BenchmarkingRow[];

  /*
    The ladder, read from the one place that derives it.

    This page used to decide for itself: `youFiled` drove an amber note reading
    "You can still see how the group looks", and then rendered every cut anyway.
    A store contributing nothing received the group's medians — the opposite of
    the exchange, and flatly contrary to the rule that non-participants get no
    results.

    Entitlement is for THIS displayed year, not the newest year the store ever
    filed: FY2026 results are bought by filing FY2026.
  */
  const ownRow = rows.find((r) => r.organization_id === organization.id);
  const tier = resultsTierFor({
    filed: Boolean(ownRow),
    disclosureLevel: (ownRow as { disclosure_level?: string | null } | undefined)
      ?.disclosure_level ?? null,
  });

  // Staff need the truth to run the programme; that is not a disclosure decision.
  if (tier === "none" && !isAdmin) {
    return (
      <ComparisonView
        organizationName={organization.name}
        fiscalYear={fiscalYear}
        cuts={[]}
        youFiled={false}
        withheldReason={NOT_PARTICIPATING_REASON}
      />
    );
  }

  const youFiled = Boolean(ownRow);

  const { data: orgRows } = await db
    .from("organizations")
    .select("id, name, province, fte")
    .in("id", rows.map((r) => r.organization_id));

  const nameById = new Map(
    (orgRows ?? []).map((o) => [o.id as string, o.name as string]),
  );
  const provinceById = new Map(
    (orgRows ?? []).map((o) => [o.id as string, (o.province as string) ?? ""]),
  );
  const fteById = new Map(
    (orgRows ?? []).map((o) => [o.id as string, (o.fte as number | null) ?? null]),
  );

  const cuts: ComparisonCut[] = [];

  // Everyone who filed. Always ≥ 4, and the honest baseline.
  cuts.push(
    buildCut({
      key: "all",
      label: "All participating stores",
      bucket: `${rows.length} stores`,
      rows,
      nameById,
      fteById,
      viewerOrgId: organization.id,
    }),
  );

  // By institution type. Uses the controlled vocabulary already on the field.
  //
  // Polytechnic is DELIBERATELY not merged into College, decided 2026-08-27,
  // even though there are only two of them and the cut therefore always
  // suppresses. They are the same size and a different business: median 10,600
  // FTE against College's 9,470, but $1,034 revenue per student against $317 —
  // trades materials, tools and equipment, at a 43% margin against 32%. Both sit
  // above every college, with a $630 gap to the highest one and nothing between.
  //
  // Merging would barely move the college median and would tell NAIT and
  // Lethbridge Polytechnic they run 3x their peers, permanently, in a panel
  // headed "Stores like yours". Suppression exists to stop a cut misleading
  // someone; a large wrong cut misleads more confidently than a small one.
  //
  // Neither store is left without comparison — both keep the all-stores and
  // regional cuts, and NAIT keeps its size band. What they lack is a TYPE peer
  // group, and the fix for that is more polytechnics filing (Sheridan, BCIT,
  // SAIT, Red River, Humber), not a broader bucket.
  const myType = rows.find((r) => r.organization_id === organization.id)
    ?.institution_type as string | undefined;
  if (myType) {
    cuts.push(
      buildCut({
        key: "type",
        label: "Stores like yours",
        bucket: myType,
        rows: rows.filter((r) => r.institution_type === myType),
        nameById,
        fteById,
        viewerOrgId: organization.id,
      }),
    );
  }

  // By region. Same buckets the recipient queue uses.
  const myRegion = REGION_OF[organization.province] ?? null;
  if (myRegion) {
    cuts.push(
      buildCut({
        key: "region",
        label: "Your region",
        bucket: myRegion,
        rows: rows.filter(
          (r) => REGION_OF[provinceById.get(r.organization_id) ?? ""] === myRegion,
        ),
        nameById,
        fteById,
        viewerOrgId: organization.id,
      }),
    );
  }

  // By size (size bands). The boundaries are the DUES tiers, read from policy — see
  // lib/benchmarking/size-band.ts for why this is not its own list of numbers.
  //
  // Banded on organizations.fte, the same figure billing charges against, so a
  // store compares in the band it pays in. That figure and the survey's own
  // enrollment_fte agreed for 38 of 39 FY2025 filers, so the choice costs
  // almost nothing in accuracy and buys a definition the member can check
  // against their invoice.
  const sizeBands = await getSizeBands();
  const myBand = resolveSizeBand(organization.fte, sizeBands);
  if (myBand) {
    cuts.push(
      buildCut({
        key: "size",
        label: "Stores your size",
        bucket: myBand.label,
        rows: rows.filter(
          (r) => resolveSizeBand(fteById.get(r.organization_id), sizeBands)?.key === myBand.key,
        ),
        nameById,
        fteById,
        viewerOrgId: organization.id,
      }),
    );
  }

  // Record that a copy was made (attribution marks). Fire and forget: a member must never be
  // refused their own report because the log was unavailable, and a missing row
  // is a smaller problem than a blocked page.
  const namedPeerCount = cuts.reduce((n, c) => n + c.named.length, 0);
  try {
    await db.from("benchmarking_report_access").insert({
      survey_fiscal_year: fiscalYear,
      recipient_organization_id: organization.id,
      viewed_by: userId,
      named_peer_count: namedPeerCount,
    });
  } catch (err) {
    console.warn("[benchmarking/compare] access log failed:", err);
  }

  return (
    <ComparisonView
      organizationName={organization.name}
      fiscalYear={fiscalYear}
      cuts={cuts}
      youFiled={youFiled}
    />
  );
}
