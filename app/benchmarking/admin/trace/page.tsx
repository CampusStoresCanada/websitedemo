import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import LeakTrace from "@/components/benchmarking/admin/LeakTrace";

export const metadata = {
  title: "Trace a leaked report | Campus Stores Canada",
};

export default async function BenchmarkingTracePage() {
  const guard = await requireAdmin();
  if (!guard.ok) redirect("/benchmarking");

  const db = createAdminClient();

  // The most recent year that has figures — the only years a leak can come from.
  const { data: years } = await db
    .from("benchmarking")
    .select("fiscal_year")
    .neq("status", "draft")
    .order("fiscal_year", { ascending: false })
    .limit(1);
  const fiscalYear = (years?.[0]?.fiscal_year as number) ?? new Date().getFullYear();

  const { data: rows } = await db
    .from("benchmarking")
    .select("organization_id")
    .eq("fiscal_year", fiscalYear)
    .neq("status", "draft");

  const { data: orgs } = await db
    .from("organizations")
    .select("id, name")
    .in("id", (rows ?? []).map((r) => r.organization_id))
    .order("name");

  return (
    <LeakTrace
      fiscalYear={fiscalYear}
      stores={(orgs ?? []).map((o) => ({ id: o.id as string, name: o.name as string }))}
    />
  );
}
