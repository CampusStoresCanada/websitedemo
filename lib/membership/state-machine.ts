import { createClient } from "@/lib/supabase/server";
import type {
  OrgMembershipStatus,
  TransitionTrigger,
} from "./types";
import { ALLOWED_TRANSITIONS } from "./types";
import { getEffectivePolicy } from "@/lib/policy/engine";
import { enqueueOrgCircleAccessSync } from "@/lib/circle/sync";

export const PUBLIC_LISTABLE_ORG_STATUSES: OrgMembershipStatus[] = [
  "active",
  "reactivated",
];

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
  const supabase = await createClient();

  // For locked → reactivated, validate reactivation window using policy
  if (newStatus === "reactivated") {
    const { data: org } = await supabase
      .from("organizations")
      .select("membership_status, locked_at")
      .eq("id", orgId)
      .single();

    if (org?.membership_status === "locked" && org?.locked_at) {
      const reactivationDays = await getEffectivePolicy<number>(
        "renewal.reactivation_days"
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
      const adminSb = await createClient();
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

/** Can this org access member/partner features? */
export function isOrgAccessActive(status: OrgMembershipStatus | null): boolean {
  return status !== null && ["active", "grace", "reactivated"].includes(status);
}

/** Should this org appear in public directories / map? */
export function isOrgPubliclyListable(status: OrgMembershipStatus | null): boolean {
  return status !== null && PUBLIC_LISTABLE_ORG_STATUSES.includes(status);
}

/** Is this org currently in a grace period? */
export function isOrgInGrace(status: OrgMembershipStatus | null): boolean {
  return status === "grace";
}

/** Can this org be reactivated (locked + within window)? */
export function canReactivate(
  status: OrgMembershipStatus | null,
  lockedAt: Date | null,
  reactivationDays: number
): boolean {
  if (status !== "locked" || !lockedAt) return false;
  const daysSinceLock =
    (Date.now() - lockedAt.getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceLock <= reactivationDays;
}

/** Is the given transition valid from a given status? */
export function isTransitionAllowed(
  fromStatus: OrgMembershipStatus | null,
  toStatus: OrgMembershipStatus
): boolean {
  if (fromStatus === null) return toStatus === "applied";
  return ALLOWED_TRANSITIONS[fromStatus].includes(toStatus);
}

/**
 * Compute days remaining in grace period.
 * Returns null if not in grace or missing data.
 */
export function graceDaysRemaining(
  status: OrgMembershipStatus | null,
  gracePeriodStartedAt: Date | null,
  graceDays: number
): number | null {
  if (status !== "grace" || !gracePeriodStartedAt) return null;
  const elapsed =
    (Date.now() - gracePeriodStartedAt.getTime()) / (1000 * 60 * 60 * 24);
  return Math.max(0, Math.ceil(graceDays - elapsed));
}
