import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticated, isGlobalAdmin } from "@/lib/auth/guards";
import AccessGrantsBoard from "@/components/admin/AccessGrantsBoard";

export const metadata = {
  title: "Access Grants | Admin",
  description: "Time-boxed capability grants and the contributions record.",
};

export default async function AccessGrantsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const auth = await requireAuthenticated();
  if (!auth.ok) redirect("/login");
  if (!isGlobalAdmin(auth.ctx.globalRole)) redirect("/");

  const { supabase } = auth.ctx;
  const params = await searchParams;
  const year = Number(params.year) || new Date().getFullYear();

  // One read, from the view that actually governs. This used to read the view
  // AND capability_grants, then join them on `${subject_id}|${capability}|
  // ${starts_at}` — but the view has term_start, not starts_at, so both sides
  // of that key were undefined and every row rendered blank with no working
  // revoke. The view now carries the assignment id, so there is nothing to
  // join to.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: appointments } = (await (createAdminClient() as any)
    .from("capability_contributions")
    .select("*")
    .order("term_start", { ascending: false })) as { data: any[] | null };

  const rows = (appointments ?? []).map((a) => ({
    id: a.assignment_id as string,
    subjectId: a.subject_id as string,
    name: (a.display_name as string) ?? "Unknown",
    capability: a.capability as string,
    roleKey: a.role_key as string,
    // Ex-officio rows cannot be ended here — you end them by changing who holds
    // the office, which is the board's business and not this page's.
    appointable: a.appointable === true,
    bodyName: (a.body_name as string) ?? null,
    reason: (a.reason as string) ?? "",
    startsAt: a.term_start as string,
    endsAt: (a.term_end as string) ?? null,
    isActive: a.is_active as boolean,
  }));

  return <AccessGrantsBoard rows={rows} year={year} />;
}
