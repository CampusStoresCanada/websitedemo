// Membership State Machine Types — Chunk 03
//
// NOTE: "MembershipStatus" already exists in lib/auth/types.ts for
// user_organizations.status (active/pending/rejected). This type covers
// the *organization-level* lifecycle status, so we prefix with "Org".

export type OrgMembershipStatus =
  | 'applied'
  | 'approved'
  | 'active'
  | 'grace'
  | 'locked'
  | 'reactivated'
  | 'canceled'

export type TransitionTrigger =
  | 'user'
  | 'admin'
  | 'system'
  | 'stripe_webhook'
  | 'renewal_job'

export interface MembershipStateLog {
  id: string
  organization_id: string
  from_status: OrgMembershipStatus | null
  to_status: OrgMembershipStatus
  triggered_by: TransitionTrigger
  actor_id: string | null
  reason: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

/** Allowed transitions map — mirrors the RPC logic for client-side validation. */
export const ALLOWED_TRANSITIONS: Record<OrgMembershipStatus, OrgMembershipStatus[]> = {
  applied:     ['approved'],
  approved:    ['active'],
  active:      ['grace', 'canceled'],
  grace:       ['active', 'locked', 'canceled'],
  locked:      ['reactivated'],
  reactivated: ['grace', 'canceled'],
  canceled:    [],
}

/** Status metadata for UI rendering. */
export const STATUS_META: Record<OrgMembershipStatus, {
  label: string
  color: string       // tailwind color token (e.g., "green", "red")
  bgClass: string     // full bg class
  textClass: string   // full text class
}> = {
  applied:     { label: 'Applied',     color: 'gray',   bgClass: 'bg-gray-100',   textClass: 'text-gray-700'   },
  approved:    { label: 'Approved',    color: 'blue',   bgClass: 'bg-blue-100',   textClass: 'text-[#D92327]'   },
  active:      { label: 'Active',      color: 'green',  bgClass: 'bg-green-100',  textClass: 'text-green-700'  },
  grace:       { label: 'Grace Period', color: 'yellow', bgClass: 'bg-yellow-100', textClass: 'text-yellow-700' },
  locked:      { label: 'Locked',      color: 'red',    bgClass: 'bg-red-100',    textClass: 'text-red-700'    },
  reactivated: { label: 'Reactivated', color: 'green',  bgClass: 'bg-green-100',  textClass: 'text-green-700'  },
  canceled:    { label: 'Canceled',    color: 'gray',   bgClass: 'bg-gray-100',   textClass: 'text-gray-500'   },
}
