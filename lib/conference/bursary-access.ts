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


/**
 * The registration seats this conference's travel bursary requests point at:
 * one per school, whoever holds it is the supported delegate. Only submitted
 * requests that were not declined.
 *
 * A seat id, never a person: a swap on the org page moves the support with the
 * seat, as it moves the CANCOLL consent with the funded registration.
 */
export async function loadBursaryDesignatedSeatIds(
  db: { from: (table: string) => { select: (columns: string) => any } }, // eslint-disable-line @typescript-eslint/no-explicit-any
  conferenceId: string
): Promise<Set<string>> {
  const { data, error } = await db
    .from("conference_bursary_applications")
    .select("delegate_seat_id, status, requested_at")
    .eq("conference_id", conferenceId)
    .not("delegate_seat_id", "is", null)
    .not("requested_at", "is", null)
    .neq("status", "denied");
  if (error) throw new Error(`Could not load travel bursary delegates: ${error.message}`);
  return new Set(((data ?? []) as Array<{ delegate_seat_id: string }>).map((r) => r.delegate_seat_id));
}
