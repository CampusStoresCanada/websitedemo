import { redirect } from "next/navigation";
import { isGlobalAdmin, requireAuthenticated } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { getFieldConfig } from "@/lib/benchmarking/default-field-config";
import { buildWorksheet, type PriorRow } from "@/lib/benchmarking/worksheet";
import WorksheetSheet from "@/components/benchmarking/WorksheetSheet";

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
export default async function BenchmarkingWorksheetPage() {
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

  // Same ordering as the survey page: a person can hold roles at more than one
  // store, and they must land on the same one here as they do there — a
  // worksheet for a different store than the form is worse than no worksheet.
  const memberOrgLink = (userOrgs ?? [])
    .filter((uo) => {
      const org = uo.organization as { type?: string } | null;
      return org?.type === "Member" && (uo.role === "org_admin" || isAdmin);
    })
    .sort((a, b) => {
      const adminFirst = Number(b.role === "org_admin") - Number(a.role === "org_admin");
      if (adminFirst !== 0) return adminFirst;
      const an = (a.organization as { name?: string } | null)?.name ?? "";
      const bn = (b.organization as { name?: string } | null)?.name ?? "";
      return an.localeCompare(bn);
    })[0];

  const organization = memberOrgLink?.organization as { id: string; name: string } | null;
  if (!organization) redirect("/benchmarking");

  // Read with the service role behind the guard above: the worksheet needs the
  // newest survey regardless of status, including `draft`, which is exactly
  // what a session client is not allowed to see.
  const db = createAdminClient();

  const { data: survey } = await db
    .from("benchmarking_surveys")
    .select("id, fiscal_year, closes_at, field_config")
    .order("fiscal_year", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!survey) redirect("/benchmarking");

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
