import { canManageOrganization, type AuthContext } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Who may fill in a school's request: anyone registered for this conference
 * from that school, or the school's admin whether or not they are registered.
 * The same people file the school's expense claim afterwards
 * (lib/expenses/sources.ts).
 */
export async function canFillBursaryRequest(
  ctx: AuthContext,
  conferenceId: string,
  organizationId: string
): Promise<boolean> {
  if (canManageOrganization(ctx, organizationId)) return true;
  const { count } = await createAdminClient()
    .from("conference_people")
    .select("id", { count: "exact", head: true })
    .eq("conference_id", conferenceId)
    .eq("organization_id", organizationId)
    .eq("user_id", ctx.userId)
    .neq("assignment_status", "canceled");
  return (count ?? 0) > 0;
}

