import { createAdminClient } from "@/lib/supabase/admin";
import type {
  OrgMembershipStatus,
  TransitionTrigger,
} from "./types";
import { ALLOWED_TRANSITIONS } from "./types";
import { getEffectivePolicy } from "@/lib/policy/engine";
import { enqueueOrgCircleAccessSync } from "@/lib/circle/sync";

// Pure status predicates live in ./status (zero imports beyond ./types) so
// client components can import them without pulling in createAdminClient,
// which is explicitly server-only. Re-exported here so existing server-side
// importers of state-machine.ts don't need to change.
export {
  PUBLIC_LISTABLE_ORG_STATUSES,
  ORG_PROFILE_RESOLVABLE_STATUSES,
  isOrgAccessActive,
  isOrgPubliclyListable,
  isOrgInGrace,
  canReactivate,
  graceDaysRemaining,
} from "./status";

// ─────────────────────────────────────────────────────────────────
// Core transition function
// ─────────────────────────────────────────────────────────────────

/**
 * Transition an organization's membership status.
 *
 * Delegates to the `transition_membership_state` SECURITY DEFINER RPC
 * which performs the transition atomically with row locking.
 */
export async function transitionMembershipState(
  orgId: string,
  newStatus: OrgMembershipStatus,
  triggeredBy: TransitionTrigger,
  actorId: string | null,
  reason: string,
  metadata?: Record<string, unknown>
): Promise<{ success: boolean; error?: string; fromStatus?: string; toStatus?: string }> {
  // Every caller already authorizes the transition before invoking this
  // (see optOutOfRenewal/approveApplication/completeOnboarding's own
  // requireAuthenticated/requireAdmin + org-membership checks; the
  // renewal_job/stripe_webhook triggers run with no user session at all).
  // Use the service-role client so the RPC never needs anon/authenticated
  // grants — matches execute_admin_transfer/publish_policy_draft.
  const supabase = createAdminClient();

  // For locked → reactivated, validate reactivation window using policy
  if (newStatus === "reactivated") {
    const { data: org } = await supabase
      .from("organizations")
      .select("membership_status, locked_at")
      .eq("id", orgId)
      .single();

    if (org?.membership_status === "locked" && org?.locked_at) {
      const reactivationDays = await getEffectivePolicy<number>(
        "renewal.reactivation_days",
        "number"
      );
      const daysSinceLock =
        (Date.now() - new Date(org.locked_at).getTime()) / (1000 * 60 * 60 * 24);

      if (daysSinceLock > reactivationDays) {
        return {
          success: false,
          error: `Reactivation window expired. Locked ${Math.floor(daysSinceLock)} days ago (limit: ${reactivationDays} days).`,
        };
      }
    }
  }

  // Call the atomic RPC
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "transition_membership_state",
    {
      p_org_id: orgId,
      p_new_status: newStatus,
      p_triggered_by: triggeredBy,
      p_actor_id: actorId,
      p_reason: reason,
      p_metadata: metadata ?? null,
    }
  );

  if (error) {
    return { success: false, error: error.message };
  }

  const result = data as {
    success: boolean;
    error?: string;
    from_status?: string;
    to_status?: string;
  };

  if (!result.success) {
    return { success: false, error: result.error };
  }

  // Fire-and-forget: sync org access groups in Circle to reflect the new status.
  // Fetches org.type internally to pick the right access group.
  void (async () => {
    try {
      const adminSb = createAdminClient();
      const { data: org } = await adminSb
        .from("organizations")
        .select("type")
        .eq("id", orgId)
        .single();
      await enqueueOrgCircleAccessSync(orgId, newStatus, org?.type ?? null);
    } catch {
      // Non-critical — transition already committed
    }
  })();

  return {
    success: true,
    fromStatus: result.from_status,
    toStatus: result.to_status,
  };
}

// ─────────────────────────────────────────────────────────────────
// Status check utilities (pure functions — no DB calls)
// ─────────────────────────────────────────────────────────────────

/** Is the given transition valid from a given status? */
export function isTransitionAllowed(
  fromStatus: OrgMembershipStatus | null,
  toStatus: OrgMembershipStatus
): boolean {
  if (fromStatus === null) return toStatus === "applied";
  return ALLOWED_TRANSITIONS[fromStatus].includes(toStatus);
}
