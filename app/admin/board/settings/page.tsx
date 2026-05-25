/**
 * /admin/board/settings  — Board Portal settings (SA only)
 */
import { redirect } from "next/navigation";
import { requireAdmin, isSuperAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import Link from "next/link";
import BoardSettingsForm from "@/components/admin/board/BoardSettingsForm";

export const metadata = {
  title: "Board Settings | Admin | Campus Stores Canada",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function BoardSettingsPage() {
  const auth = await requireAdmin();
  if (!auth.ok || !isSuperAdmin(auth.ctx.globalRole)) redirect("/admin/board/meetings");

  const db = createAdminClient();
  const { data: settings } = await db
    .from("app_settings")
    .select("key, value, description")
    .in("key", ["action_item_reminder_days"]);

  const settingsMap = Object.fromEntries(
    (settings ?? []).map((s) => [s.key, s.value])
  );

  return (
    <main>
      <AdminPageHeader
        title="Board Settings"
        description="Configuration for the Board Portal"
        actions={
          <Link
            href="/admin/board/meetings"
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            ← Board Portal
          </Link>
        }
      />

      <BoardSettingsForm
        reminderDays={parseInt(settingsMap["action_item_reminder_days"] ?? "3", 10)}
      />
    </main>
  );
}
