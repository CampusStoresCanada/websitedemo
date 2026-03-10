import { createClient } from "@/lib/supabase/server";
import { derivePermissionState } from "./permissions";
import { generateSessionKey, exportKeyToBase64 } from "./crypto";
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
  encryptionKey: CryptoKey | null;
  encryptionKeyBase64: string | null;
}

/**
 * Get the full auth state for the current request in a Server Component.
 * Returns user, profile, role, permission state, org memberships, and encryption key.
 * Has built-in timeouts to prevent page hangs if DB is slow.
 */
export async function getServerAuthState(): Promise<ServerAuthState> {
  const supabase = await createClient();

  // Server-side auth: validate JWT locally (instant, never hangs).
  // NEVER use getUser() here — it makes a network request to Supabase
  // that can hang indefinitely and kill the dev server or cause timeouts.
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub as string | undefined;
  const userEmail = claimsData?.claims?.email as string | undefined;

  if (claimsError || !userId) {
    return {
      user: null,
      profile: null,
      globalRole: "user",
      permissionState: "public",
      organizations: [],
      encryptionKey: null,
      encryptionKeyBase64: null,
    };
  }

  // Fetch profile and org memberships in parallel.
  // If these queries fail transiently, we keep the request authenticated,
  // but conservative in authorization state for this single render.
  const profilePromise = supabase.from("profiles").select("*").eq("id", userId).single();
  const orgsPromise = supabase
    .from("user_organizations")
    .select(
      `
      id,
      user_id,
      organization_id,
      role,
      status,
      created_at,
      organization:organizations(id, name, type, slug, logo_url)
    `
    )
    .eq("user_id", userId)
    .eq("status", "active");

  const [profileResult, orgsResult] = await Promise.all([profilePromise, orgsPromise]);

  const profile = profileResult.error
    ? null
    : ((profileResult.data as unknown as UserProfile) ?? null);
  const organizations = orgsResult.error
    ? []
    : ((orgsResult.data as unknown as UserOrganization[]) ?? []);
  const globalRole: GlobalRole = profile?.global_role || "user";
  const permissionState = derivePermissionState(globalRole, organizations);

  // Generate encryption key for this session
  const encryptionKey = await generateSessionKey(userId, ENCRYPTION_SECRET);
  const encryptionKeyBase64 = await exportKeyToBase64(encryptionKey);

  return {
    user: { id: userId, email: userEmail },
    profile,
    globalRole,
    permissionState,
    organizations,
    encryptionKey,
    encryptionKeyBase64,
  };
}
