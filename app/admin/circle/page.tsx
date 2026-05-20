import { getCircleCutoverStatus } from "@/lib/circle/cutover";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import CircleCutoverClient from "./CircleCutoverClient";

export const metadata = {
  title: "Circle Cutover | Admin | Campus Stores Canada",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CircleCutoverPage() {
  const status = await getCircleCutoverStatus();

  return (
    <main>
      <AdminPageHeader
        title="Circle Integration"
        description="Launch Day Auth Cutover controls. Supabase is the canonical identity source."
      />
      <CircleCutoverClient initialStatus={status} />
    </main>
  );
}
