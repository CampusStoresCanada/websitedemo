import { redirect } from "next/navigation";
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: grants } = (await (supabase as any)
    .from("capability_contributions")
    .select("*")
    .order("starts_at", { ascending: false })) as { data: any[] | null };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawGrants } = (await (supabase as any)
    .from("capability_grants")
    .select("id, subject_id, capability, starts_at, ends_at, revoked_at")) as {
    data: any[] | null;
  };
  const idByKey = new Map(
    (rawGrants ?? []).map((g) => [
      `${g.subject_id}|${g.capability}|${g.starts_at}`,
      g.id,
    ]),
  );

  const rows = (grants ?? []).map((g) => ({
    id: idByKey.get(`${g.subject_id}|${g.capability}|${g.starts_at}`) ?? "",
    subjectId: g.subject_id as string,
    name: (g.display_name as string) ?? "Unknown",
    capability: g.capability as string,
    reason: g.reason as string,
    grantedByName: (g.granted_by_name as string) ?? null,
    startsAt: g.starts_at as string,
    endsAt: g.ends_at as string,
    revokedAt: g.revoked_at as string | null,
    isActive: g.is_active as boolean,
  }));

  return <AccessGrantsBoard rows={rows} year={year} />;
}
