import { cache } from "react";
import { getIdentitySnapshot } from "./guards";
import { derivePermissionState } from "./permissions";
import { generateSessionKey, exportKeyToBase64 } from "./crypto";
import { getProgramsConfig } from "@/lib/policy/engine";
import { CAPABILITY } from "@/lib/constants/capabilities";
import type { MembershipProgramDef } from "@/lib/policy/types";
import type {
  GlobalRole,
  PermissionState,
  UserOrganization,
  UserProfile,
} from "./types";

const ENCRYPTION_SECRET = process.env.CONTENT_ENCRYPTION_SECRET || "csc-demo-secret-change-in-production";

export interface ServerAuthState {
  user: { id: string; email: string | undefined } | null;
  profile: UserProfile | null;
  globalRole: GlobalRole;
  permissionState: PermissionState;
  organizations: UserOrganization[];
  /** Resolved from the benchmarking_reviewer role through
   *  governance_role_capabilities — never a flag on the profile row. */
  isBenchmarkingReviewer: boolean;
  /** Resolved once per request, threaded into AuthProvider's initialAuth so
   *  client-side permission re-derivation (on auth-state-change) reuses this
   *  instead of re-fetching — see components/providers/AuthProvider.tsx. */
  programs: MembershipProgramDef[];
  encryptionKey: CryptoKey | null;
  encryptionKeyBase64: string | null;
}

/**
 * Get the full auth state for the current request in a Server Component.
 * Returns user, profile, role, permission state, org memberships, and encryption key.
 * Reads the shared, per-request-memoized identity snapshot (lib/auth/guards.ts)
 * instead of querying directly — cheap even if called more than once per request.
 */
export const getServerAuthState = cache(async (): Promise<ServerAuthState> => {
  const [snapshot, programs] = await Promise.all([getIdentitySnapshot(), getProgramsConfig()]);

  if (snapshot.status === "anonymous") {
    return {
      user: null,
      profile: null,
      globalRole: "user",
      permissionState: "public",
      organizations: [],
      isBenchmarkingReviewer: false,
      programs,
      encryptionKey: null,
      encryptionKeyBase64: null,
    };
  }

  const profile = snapshot.profileError ? null : snapshot.profile;
  const organizations = snapshot.orgsError ? [] : (snapshot.organizations ?? []);
  const globalRole: GlobalRole = profile?.global_role || "user";
  const permissionState = derivePermissionState(globalRole, organizations, programs);

  // Generate encryption key for this session
  const encryptionKey = await generateSessionKey(snapshot.userId, ENCRYPTION_SECRET);
  const encryptionKeyBase64 = await exportKeyToBase64(encryptionKey);

  return {
    user: { id: snapshot.userId, email: snapshot.userEmail ?? undefined },
    profile,
    globalRole,
    permissionState,
    organizations,
    isBenchmarkingReviewer: snapshot.capabilities.includes(CAPABILITY.benchmarkingContentReview),
    programs,
    encryptionKey,
    encryptionKeyBase64,
  };
});
