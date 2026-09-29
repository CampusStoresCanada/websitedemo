import { redirect } from "next/navigation";
import { isGlobalAdmin, requireAuthenticated } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { getFieldConfig } from "@/lib/benchmarking/default-field-config";
import { buildWorksheet, type PriorRow } from "@/lib/benchmarking/worksheet";
import WorksheetSheet from "@/components/benchmarking/WorksheetSheet";
import AdminOrgSwitcher from "@/components/conference/AdminOrgSwitcher";
import { resolveActingOrg } from "@/lib/benchmarking/acting-org";

export const metadata = {
  title: "Benchmarking worksheet | Campus Stores Canada",
  description: "Print the figures you will need before you fill in the survey.",
};

/**
 * The gathering worksheet for the reader's own store.
 *
 * Deliberately NOT gated on resolveSurveyAccess. The whole point of this page
 * is to be usable before the survey opens — briefing 4 sends it to beta stores
 * days ahead so they can collect their figures first, and a sheet that only
 * appears once the doors are open arrives too late to do its job. What it needs
 * is a survey record to describe, not an open one.
 *
 * It does show the store's own historical figures, so it is scoped exactly like
 * the survey: you see your store, and an admin previewing sees whichever store
 * they resolve to. Never anyone else's.
 */
export default async function BenchmarkingWorksheetPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const params = await searchParams;
  const auth = await requireAuthenticated();
  if (!auth.ok) redirect("/login");

  const { supabase, userId, globalRole } = auth.ctx;
  const isAdmin = isGlobalAdmin(globalRole);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: userOrgs } = (await (supabase as any)
    .from("user_organizations")
    .select("organization_id, role, organization:organizations(id, name, type)")
    .eq("user_id", userId)
    .eq("status", "active")) as { data: any[] | null };

  // Read with the service role behind the guard above: the worksheet needs the
  // newest survey regardless of status, including `draft`.
  const db = createAdminClient();

  const { data: survey } = await db
    .from("benchmarking_surveys")
    .select("id, fiscal_year, closes_at, field_config")
    .order("fiscal_year", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!survey) redirect("/benchmarking");

  /*
    Same store the survey resolves to, by the same function.

    This page used to resolve the org itself, with the filter that put `isAdmin`
    on the role clause instead of the attachment one — so a CSC staffer, who is
    linked to the Staff org, resolved to nothing and was bounced to the landing
    page. Clicking "gather on paper first" from the survey did nothing at all.
  */
  const { organization, adminOrgOptions, isActingAsOther } = await resolveActingOrg({
    userOrgs: userOrgs ?? [],
    isAdmin,
    requestedOrgId: params?.org ?? null,
    surveyId: survey.id,
  });

  if (!organization) {
    if (isAdmin && adminOrgOptions.length > 0) {
      return (
        <div className="mx-auto max-w-3xl px-4 py-10">
          <h1 className="text-2xl font-bold text-gray-900">Gathering worksheet</h1>
          <p className="mt-2 text-sm text-gray-600">
            Pick the store whose worksheet you want. It carries that store&apos;s own
            figures from previous years, so it is only useful once you have chosen one.
          </p>
          <div className="mt-5">
            <AdminOrgSwitcher
              orgs={adminOrgOptions}
              selectedOrgId={null}
              basePath="/benchmarking/worksheet"
              label="print the worksheet for"
            />
          </div>
        </div>
      );
    }
    redirect("/benchmarking");
  }

  // (survey already loaded above)

  // Every prior year we hold for THIS store. Scoped by organization_id, never
  // by anything the reader supplies.
  const { data: priorRows } = await db
    .from("benchmarking")
    .select("*")
    .eq("organization_id", organization.id)
    .lt("fiscal_year", survey.fiscal_year)
    .order("fiscal_year", { ascending: false });

  const worksheet = buildWorksheet({
    organizationName: organization.name,
    fiscalYear: survey.fiscal_year,
    closesAt: survey.closes_at,
    config: getFieldConfig(survey),
    priorRows: (priorRows ?? []) as unknown as PriorRow[],
  });

  return (
    <div className="min-h-screen bg-neutral-100 py-8 print:bg-white print:py-0">
      {/*
        Scoped to this page rather than added to the shared Header and Footer,
        which are mid-edit elsewhere and are not mine to change for every route.

        The site chrome sits OUTSIDE <main>; the worksheet's own header and
        footer sit inside it. So: hide every header and footer for print, then
        put back the ones belonging to the document. Blanket-hiding by tag alone
        would take the worksheet's letterhead and its footnotes with it.

        Fixed-position furniture is hidden too — floating buttons render on
        paper as a grey blob in the corner of page one.
      */}
      <style>{`
        @media print {
          header, footer { display: none !important; }
          main header, main footer { display: block !important; }
          .fixed, [style*="position: fixed"] { display: none !important; }
        }
      `}</style>
      <WorksheetSheet worksheet={worksheet} />
    </div>
  );
}
