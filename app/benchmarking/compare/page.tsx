import { redirect } from "next/navigation";
import { isGlobalAdmin, requireAuthenticated } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildCut,
  REGION_OF,
  type BenchmarkingRow,
  type ComparisonCut,
} from "@/lib/benchmarking/comparison";
import ComparisonView from "@/components/benchmarking/ComparisonView";
import { getSizeBands, resolveSizeBand } from "@/lib/benchmarking/size-band";

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
export default async function BenchmarkingComparePage() {
  const auth = await requireAuthenticated();
  if (!auth.ok) redirect("/login");

  const { supabase, userId, globalRole } = auth.ctx;
  const isAdmin = isGlobalAdmin(globalRole);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: userOrgs } = (await (supabase as any)
    .from("user_organizations")
    .select("organization_id, role, organization:organizations(id, name, type, province, fte)")
    .eq("user_id", userId)
    .eq("status", "active")) as { data: any[] | null };

  // Same ordering as the survey and the worksheet, so one person who
  // administers two stores lands on the same one everywhere.
  const link = (userOrgs ?? [])
    .filter((uo) => {
      const org = uo.organization as { type?: string } | null;
      return org?.type === "Member" && (uo.role === "org_admin" || isAdmin);
    })
    .sort((a, b) => {
      const adminFirst = Number(b.role === "org_admin") - Number(a.role === "org_admin");
      if (adminFirst !== 0) return adminFirst;
      return ((a.organization as any)?.name ?? "").localeCompare(
        (b.organization as any)?.name ?? "",
      );
    })[0];

  const organization = link?.organization as
    | { id: string; name: string; province: string; fte: number | null }
    | undefined;
  if (!organization) redirect("/benchmarking");

  const db = createAdminClient();

  // The newest year anyone has actually filed.
  const { data: years } = await db
    .from("benchmarking")
    .select("fiscal_year")
    .not("status", "eq", "draft")
    .order("fiscal_year", { ascending: false })
    .limit(1);
  const fiscalYear = (years?.[0]?.fiscal_year as number) ?? null;

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

  const { data: rowsRaw } = await db
    .from("benchmarking")
    .select("*")
    .eq("fiscal_year", fiscalYear)
    .not("status", "eq", "draft");

  const rows = (rowsRaw ?? []) as unknown as BenchmarkingRow[];
  const youFiled = rows.some((r) => r.organization_id === organization.id);

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
