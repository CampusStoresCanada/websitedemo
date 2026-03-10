import type { User } from "@supabase/supabase-js";

// Global roles stored on the profiles table
export type GlobalRole = "super_admin" | "admin" | "user";

// Organization-level roles stored on user_organizations table
export type OrgRole = "org_admin" | "member";

// Effective permission state derived from global role + org memberships
// Ordered by privilege level (highest to lowest)
export type PermissionState =
  | "super_admin"
  | "admin"
  | "org_admin"
  | "survey_participant" // org_admin of a member org that completed the survey
  | "member"
  | "partner"
  | "public";

// Numeric permission levels for comparison
export const PERMISSION_LEVELS: Record<PermissionState, number> = {
  super_admin: 5,
  admin: 4,
  org_admin: 3,
  survey_participant: 3, // Same level as org_admin, but requires additional check
  member: 2,
  partner: 1,
  public: 0,
};

export type ApplicationStatus = "pending" | "approved" | "rejected";
export type ApplicationType = "join_existing" | "new_member" | "new_partner";
export type MembershipStatus = "active" | "pending" | "rejected";

export interface UserProfile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  global_role: GlobalRole;
  is_benchmarking_reviewer: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserOrganization {
  id: string;
  user_id: string;
  organization_id: string;
  role: OrgRole;
  status: MembershipStatus;
  created_at: string;
  organization: {
    id: string;
    name: string;
    type: string;
    slug: string;
    logo_url: string | null;
  };
}

export interface SignupApplication {
  id: string;
  user_id: string;
  organization_id: string | null;
  status: ApplicationStatus;
  application_type: ApplicationType;
  application_data: Record<string, unknown>;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string;
}

export interface AuthState {
  user: User | null;
  profile: UserProfile | null;
  globalRole: GlobalRole;
  permissionState: PermissionState;
  organizations: UserOrganization[];
  isLoading: boolean;
  /** True if the user's primary member org has completed the benchmarking survey */
  isSurveyParticipant: boolean;
  /** True if the user is tagged as a benchmarking reviewer */
  isBenchmarkingReviewer: boolean;
}

// Shape descriptor for encrypted content placeholders
export interface PlaceholderShape {
  type: string;
  count: number;
  fieldWidths: number[];
}

// Encrypted field wrapper
export interface EncryptedField<T = unknown> {
  encrypted: string; // base64-encoded encrypted data
  iv: string; // base64-encoded initialization vector
  placeholder: PlaceholderShape;
  _plaintext?: T; // only present when user is authorized (stripped before sending to unauthorized)
}
