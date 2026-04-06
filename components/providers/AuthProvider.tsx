"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { createClient } from "@/lib/supabase/client";
import { derivePermissionState } from "@/lib/auth/permissions";
import type { User } from "@supabase/supabase-js";
import type {
  GlobalRole,
  PermissionState,
  UserOrganization,
  UserProfile,
} from "@/lib/auth/types";

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  globalRole: GlobalRole;
  permissionState: PermissionState;
  organizations: UserOrganization[];
  isLoading: boolean;
  decryptionKey: CryptoKey | null;
  /** True if the user's primary member org has completed the benchmarking survey */
  isSurveyParticipant: boolean;
  /** True if the user is tagged as a benchmarking reviewer */
  isBenchmarkingReviewer: boolean;
  signOut: () => Promise<void>;
  refreshPermissions: () => Promise<void>;
  devOverride: PermissionState | null;
  setDevOverride: (state: PermissionState | null) => void;
  devSurveyParticipantOverride: boolean | null;
  setDevSurveyParticipantOverride: (override: boolean | null) => void;
  requiresReauth: boolean;
  reauthMessage: string | null;
  reauthUrl: string;
  reauthCountdownSeconds: number;
  idleWarningVisible: boolean;
  idleSecondsRemaining: number;
  keepSessionAlive: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  profile: null,
  globalRole: "user",
  permissionState: "public",
  organizations: [],
  isLoading: true,
  decryptionKey: null,
  isSurveyParticipant: false,
  isBenchmarkingReviewer: false,
  signOut: async () => {},
  refreshPermissions: async () => {},
  devOverride: null,
  setDevOverride: () => {},
  devSurveyParticipantOverride: null,
  setDevSurveyParticipantOverride: () => {},
  requiresReauth: false,
  reauthMessage: null,
  reauthUrl: "/login",
  reauthCountdownSeconds: 0,
  idleWarningVisible: false,
  idleSecondsRemaining: 0,
  keepSessionAlive: () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

interface AuthProviderProps {
  children: React.ReactNode;
  initialAuth?: {
    user: { id: string; email?: string } | null;
    profile: UserProfile | null;
    globalRole: GlobalRole;
    permissionState: PermissionState;
    organizations: UserOrganization[];
    isSurveyParticipant: boolean;
    isBenchmarkingReviewer: boolean;
  } | null;
}

const MAX_PERMISSION_RETRIES = 3;
const RETRY_BASE_MS = 500;
const REAUTH_REDIRECT_DELAY_MS = 25000;
const AUTH_BOOTSTRAP_TIMEOUT_MS = 8000;
const AUTH_FETCH_TIMEOUT_MS = 2500;
const ADMIN_IDLE_TIMEOUT_MS = 8 * 60 * 60 * 1000;
const STANDARD_IDLE_TIMEOUT_MS = 25 * 60 * 1000;
const STANDARD_IDLE_WARNING_MS = 5 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

function describeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      type: err.constructor?.name ?? "Error",
      name: err.name,
      message: err.message,
      stack: err.stack ?? null,
      cause:
        typeof err.cause === "undefined"
          ? null
          : describeError(err.cause),
    };
  }

  if (typeof err === "object" && err !== null) {
    const objectRecord = err as Record<string, unknown>;
    const ownNames = Object.getOwnPropertyNames(err);
    const ownEntries = ownNames.reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = objectRecord[key];
      return acc;
    }, {});

    const knownFields = {
      code: objectRecord.code ?? null,
      message: objectRecord.message ?? null,
      details: objectRecord.details ?? null,
      hint: objectRecord.hint ?? null,
      status: objectRecord.status ?? objectRecord.statusCode ?? null,
      error: objectRecord.error ?? objectRecord.error_description ?? null,
    };

    return {
      type: err.constructor?.name ?? "Object",
      ...knownFields,
      keys: ownNames,
      ownEntries,
      asString: String(err),
    };
  }

  return { type: typeof err, value: err };
}

function isExpectedMissingSessionError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const maybeError = err as { name?: string; message?: string };
  const name = (maybeError.name ?? "").toLowerCase();
  const message = (maybeError.message ?? "").toLowerCase();
  return (
    name.includes("authsessionmissingerror") ||
    message.includes("auth session missing")
  );
}

async function emitAuthTelemetry(
  event: "auth_idle_timeout" | "auth_bootstrap_recovery_failed",
  details: Record<string, unknown>
): Promise<void> {
  try {
    await fetch("/api/telemetry/auth-event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      keepalive: true,
      body: JSON.stringify({ event, details }),
    });
  } catch {
    // non-blocking telemetry
  }
}

export function AuthProvider({ children, initialAuth = null }: AuthProviderProps) {
  const hasInitialAuthUser = Boolean(initialAuth?.user);
  const initialUser = initialAuth?.user
    ? ({ id: initialAuth.user.id, email: initialAuth.user.email } as User)
    : null;
  // Auth state - starts empty, populated from client-side cookie check
  const [user, setUser] = useState<User | null>(initialUser);
  const [profile, setProfile] = useState<UserProfile | null>(
    initialAuth?.profile ?? null
  );
  const [globalRole, setGlobalRole] = useState<GlobalRole>(
    initialAuth?.globalRole ?? "user"
  );
  const [permissionState, setPermissionState] =
    useState<PermissionState>(initialAuth?.permissionState ?? "public");
  const [organizations, setOrganizations] = useState<UserOrganization[]>(
    initialAuth?.organizations ?? []
  );
  const [isSurveyParticipant, setIsSurveyParticipant] =
    useState<boolean>(initialAuth?.isSurveyParticipant ?? false);
  const [isBenchmarkingReviewer, setIsBenchmarkingReviewer] =
    useState<boolean>(initialAuth?.isBenchmarkingReviewer ?? false);
  const [isLoading, setIsLoading] = useState(initialAuth ? false : true);
  const [decryptionKey, setDecryptionKey] = useState<CryptoKey | null>(null);
  const [devOverride, setDevOverride] = useState<PermissionState | null>(null);
  const [devSurveyParticipantOverride, setDevSurveyParticipantOverride] =
    useState<boolean | null>(null);
  const [requiresReauth, setRequiresReauth] = useState(false);
  const [reauthMessage, setReauthMessage] = useState<string | null>(null);
  const [reauthCountdownSeconds, setReauthCountdownSeconds] = useState(0);
  const [reauthUrl] = useState("/login");
  const [idleWarningVisible, setIdleWarningVisible] = useState(false);
  const [idleSecondsRemaining, setIdleSecondsRemaining] = useState(0);
  const consecutivePermissionFailuresRef = useRef(0);
  const lastActivityAtRef = useRef<number>(0);
  const idleTimeoutTriggeredRef = useRef(false);
  const ensuredCircleSessionForUserRef = useRef<string | null>(null);
  const finalizedConferenceAssignmentsForUserRef = useRef<string | null>(null);
  const bootstrapResolvedRef = useRef(Boolean(initialAuth));
  const lastKnownGoodRef = useRef<{
    userId: string;
    profile: UserProfile | null;
    globalRole: GlobalRole;
    permissionState: PermissionState;
    organizations: UserOrganization[];
    isSurveyParticipant: boolean;
    isBenchmarkingReviewer: boolean;
  } | null>(
    initialAuth
      ? {
          userId: initialAuth.user?.id ?? "",
          profile: initialAuth.profile,
          globalRole: initialAuth.globalRole,
          permissionState: initialAuth.permissionState,
          organizations: initialAuth.organizations,
          isSurveyParticipant: initialAuth.isSurveyParticipant,
          isBenchmarkingReviewer: initialAuth.isBenchmarkingReviewer,
        }
      : null
  );

  const supabase = useMemo(() => createClient(), []);

  const clearAuthState = useCallback(() => {
    setUser(null);
    setProfile(null);
    setOrganizations([]);
    setGlobalRole("user");
    setPermissionState("public");
    setIsSurveyParticipant(false);
    setIsBenchmarkingReviewer(false);
    setDecryptionKey(null);
    setDevOverride(null);
    setDevSurveyParticipantOverride(null);
    setIdleWarningVisible(false);
    setIdleSecondsRemaining(0);
    ensuredCircleSessionForUserRef.current = null;
    finalizedConferenceAssignmentsForUserRef.current = null;
    lastKnownGoodRef.current = null;
    consecutivePermissionFailuresRef.current = 0;
  }, []);

  const ensureCircleSession = useCallback(async (userId: string) => {
    if (ensuredCircleSessionForUserRef.current === userId) {
      return;
    }

    ensuredCircleSessionForUserRef.current = userId;

    try {
      const response = await fetch("/api/circle/session/ensure", {
        method: "POST",
        credentials: "same-origin",
      });
      if (!response.ok) {
        ensuredCircleSessionForUserRef.current = null;
      }
    } catch {
      ensuredCircleSessionForUserRef.current = null;
    }
  }, []);

  const finalizePendingConferenceAssignments = useCallback(async (userId: string) => {
    if (finalizedConferenceAssignmentsForUserRef.current === userId) {
      return;
    }

    finalizedConferenceAssignmentsForUserRef.current = userId;

    try {
      await fetch("/api/conference/assignments/finalize", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
        },
      });
    } catch {
      // Non-blocking: assignment finalization retries next auth refresh.
      finalizedConferenceAssignmentsForUserRef.current = null;
    }
  }, []);

  const keepSessionAlive = useCallback(() => {
    lastActivityAtRef.current = Date.now();
    idleTimeoutTriggeredRef.current = false;
    setIdleWarningVisible(false);
    setIdleSecondsRemaining(0);
  }, []);

  const finishBootstrap = useCallback(() => {
    if (bootstrapResolvedRef.current) return;
    bootstrapResolvedRef.current = true;
    setIsLoading(false);
  }, []);

  const fetchUserData = useCallback(
    async (userId: string) => {
      const [profileResult, orgsResult] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", userId).single(),
        supabase
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
          .eq("status", "active"),
      ]);

      if (profileResult.error || orgsResult.error) {
        console.error("[AuthProvider] query errors:", JSON.stringify({
          profileError: profileResult.error ? {
            message: profileResult.error.message,
            code: profileResult.error.code,
            details: profileResult.error.details,
            hint: profileResult.error.hint,
          } : null,
          orgsError: orgsResult.error ? {
            message: orgsResult.error.message,
            code: orgsResult.error.code,
            details: orgsResult.error.details,
            hint: orgsResult.error.hint,
          } : null,
        }, null, 2));
        throw new Error("Failed to fetch profile or organization membership");
      }

      const userProfile = (profileResult.data as unknown as UserProfile) || null;
      const userOrgs = (orgsResult.data as unknown as UserOrganization[]) || [];
      const role: GlobalRole = userProfile?.global_role || "user";
      const resolvedPermissionState = derivePermissionState(role, userOrgs);

      // Super admins and admins always have survey access.
      // For other roles, attempt benchmarking lookup best-effort only.
      let hasSurveyData = role === "super_admin" || role === "admin";
      if (!hasSurveyData) {
        const memberOrgIds = userOrgs
          .filter(
            (uo) =>
              uo.organization?.type === "Member" &&
              uo.role === "org_admin" &&
              uo.status === "active"
          )
          .map((uo) => uo.organization_id);

        if (memberOrgIds.length > 0) {
          const { data: benchmarkingData, error: benchmarkingError } = await supabase
            .from("benchmarking")
            .select("organization_id")
            .in("organization_id", memberOrgIds)
            .limit(1);

          if (benchmarkingError) {
            console.warn("[AuthProvider] benchmarking query failed (non-blocking)", {
              code: benchmarkingError.code,
              message: benchmarkingError.message,
            });
          } else {
            hasSurveyData = (benchmarkingData?.length ?? 0) > 0;
          }
        }
      }

      setProfile(userProfile);
      setOrganizations(userOrgs);
      setGlobalRole(role);
      setPermissionState(resolvedPermissionState);
      setIsSurveyParticipant(hasSurveyData);
      setIsBenchmarkingReviewer(userProfile?.is_benchmarking_reviewer ?? false);
      setRequiresReauth(false);
      setReauthMessage(null);
      setReauthCountdownSeconds(0);
      consecutivePermissionFailuresRef.current = 0;
      lastKnownGoodRef.current = {
        userId,
        profile: userProfile,
        globalRole: role,
        permissionState: resolvedPermissionState,
        organizations: userOrgs,
        isSurveyParticipant: hasSurveyData,
        isBenchmarkingReviewer: userProfile?.is_benchmarking_reviewer ?? false,
      };

      console.log("[AuthProvider] fetchUserData success:", {
        userId,
        profileFound: !!userProfile,
        globalRole: role,
        permission: resolvedPermissionState,
        orgsCount: userOrgs.length,
      });
    },
    [supabase]
  );

  useEffect(() => {
    let mounted = true;

    const loadSession = async (
      session: { user: User } | null,
      source: string
    ) => {
      if (!mounted) return;

      if (!session?.user) {
        clearAuthState();
        finishBootstrap();
        return;
      }

      console.log(`[AuthProvider] loadSession (${source}):`, session.user.email);
      setUser(session.user);
      const previousSnapshotUserId = lastKnownGoodRef.current?.userId ?? null;
      if (previousSnapshotUserId && previousSnapshotUserId !== session.user.id) {
        // Session switched accounts. Reset authz state to safe defaults until fresh fetch succeeds.
        setProfile(null);
        setOrganizations([]);
        setGlobalRole("user");
        setPermissionState("public");
        setIsSurveyParticipant(false);
        setIsBenchmarkingReviewer(false);
        setDevOverride(null);
        setDevSurveyParticipantOverride(null);
        lastKnownGoodRef.current = null;
      }
      void ensureCircleSession(session.user.id);
      void finalizePendingConferenceAssignments(session.user.id);
      // Session identity is known at this point; do not block the entire app shell
      // while profile/permission hydration retries in the background.
      finishBootstrap();

      let fetched = false;
      for (let attempt = 1; attempt <= MAX_PERMISSION_RETRIES; attempt++) {
        try {
          await withTimeout(
            fetchUserData(session.user.id),
            AUTH_FETCH_TIMEOUT_MS,
            "fetchUserData"
          );
          fetched = true;
          break;
        } catch (err) {
          consecutivePermissionFailuresRef.current += 1;
          const isLastAttempt = attempt === MAX_PERMISSION_RETRIES;
          const delay = RETRY_BASE_MS * 2 ** (attempt - 1);
          const errorDetails = describeError(err);
          const errorText =
            Object.keys(errorDetails).length > 0
              ? null
              : err instanceof Error
                ? err.message
                : String(err ?? "unknown error");

          console.warn("[AuthProvider] fetchUserData attempt failed:", {
            attempt,
            isLastAttempt,
            err: errorDetails,
            errorText,
          });

          if (!isLastAttempt) {
            await sleep(delay + Math.floor(Math.random() * 150));
          }
        }
      }

      if (!fetched) {
        // Keep last known good permissions if we have them. Do not downgrade on transient data errors.
        if (lastKnownGoodRef.current?.userId === session.user.id) {
          console.warn(
            "[AuthProvider] retaining last-known-good permissions after repeated fetch failures",
            { failures: consecutivePermissionFailuresRef.current }
          );
          setProfile(lastKnownGoodRef.current.profile);
          setGlobalRole(lastKnownGoodRef.current.globalRole);
          setPermissionState(lastKnownGoodRef.current.permissionState);
          setOrganizations(lastKnownGoodRef.current.organizations);
          setIsSurveyParticipant(lastKnownGoodRef.current.isSurveyParticipant);
          setIsBenchmarkingReviewer(
            lastKnownGoodRef.current.isBenchmarkingReviewer
          );
        } else if (
          consecutivePermissionFailuresRef.current >= MAX_PERMISSION_RETRIES
        ) {
          // No valid permission snapshot to trust yet. Keep the session alive and
          // avoid forced sign-out loops; server guards enforce authorization.
          console.error(
            "[AuthProvider] no trusted permission snapshot available; deferring reauth while session remains valid"
          );
        }
      }

      if (mounted) finishBootstrap();
    };

    const recoverSessionFromUser = async (source: string): Promise<boolean> => {
      const {
        data: { user: fallbackUser },
        error: fallbackUserError,
      } = await withTimeout(
        supabase.auth.getUser(),
        AUTH_FETCH_TIMEOUT_MS,
        "getUser"
      );

      if (fallbackUserError) {
        if (isExpectedMissingSessionError(fallbackUserError)) {
          return false;
        }
        throw fallbackUserError;
      }

      if (!fallbackUser) {
        return false;
      }

      await loadSession({ user: fallbackUser }, source);
      return true;
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;
      console.log("[AuthProvider] onAuthStateChange:", event);
      if (event === "SIGNED_OUT" || (event as string) === "USER_DELETED") {
        await loadSession(null, event);
        return;
      }
      await loadSession(session, event);
    });

    // Bootstrap from current session — but SKIP if the server already provided
    // initialAuth. The server used getClaims() (instant JWT check) so we trust it.
    // Running getSession() redundantly causes 8s hangs and AbortErrors.
    if (!hasInitialAuthUser) {
      (async () => {
        try {
          const {
            data: { session },
            error,
          } = await withTimeout(
            supabase.auth.getSession(),
            AUTH_BOOTSTRAP_TIMEOUT_MS,
            "getSession"
          );

          if (error) {
            console.error("[AuthProvider] getSession failed during bootstrap:", error);
            const recovered = await recoverSessionFromUser(
              "BOOTSTRAP_RECOVERY_AFTER_SESSION_ERROR"
            ).catch((recoverErr) => {
              if (!isExpectedMissingSessionError(recoverErr)) {
                console.error("[AuthProvider] getUser recovery failed:", recoverErr);
              }
              return false;
            });

            if (!recovered && mounted) {
              void emitAuthTelemetry("auth_bootstrap_recovery_failed", {
                source: "BOOTSTRAP_RECOVERY_AFTER_SESSION_ERROR",
                hadSessionError: true,
              });
              clearAuthState();
              finishBootstrap();
            }
            return;
          }

          if (!session?.user) {
            const recovered = await recoverSessionFromUser(
              "BOOTSTRAP_RECOVERY_AFTER_EMPTY_SESSION"
            );
            if (!recovered) {
              await loadSession(null, "BOOTSTRAP_EMPTY_SESSION");
            }
            return;
          }

          await loadSession(session as { user: User }, "BOOTSTRAP");
        } catch (err) {
          console.error("[AuthProvider] bootstrap error:", err);
          const recovered = await recoverSessionFromUser(
            "BOOTSTRAP_RECOVERY_AFTER_THROW"
          ).catch((recoverErr) => {
            if (!isExpectedMissingSessionError(recoverErr)) {
              console.error("[AuthProvider] getUser recovery after throw failed:", recoverErr);
            }
            return false;
          });

          if (!recovered && mounted) {
            void emitAuthTelemetry("auth_bootstrap_recovery_failed", {
              source: "BOOTSTRAP_RECOVERY_AFTER_THROW",
              hadBootstrapThrow: true,
            });
            clearAuthState();
            finishBootstrap();
          }
        }
      })();
    } else {
      console.log("[AuthProvider] skipping bootstrap — server provided initialAuth");
    }

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase, fetchUserData, clearAuthState, finishBootstrap, ensureCircleSession, finalizePendingConferenceAssignments, hasInitialAuthUser]);

  useEffect(() => {
    if (!requiresReauth) return;

    const deadline = Date.now() + REAUTH_REDIRECT_DELAY_MS;
    const tick = setInterval(() => {
      const remainingMs = Math.max(0, deadline - Date.now());
      setReauthCountdownSeconds(Math.ceil(remainingMs / 1000));
    }, 250);

    const timer = setTimeout(() => {
      window.location.assign(reauthUrl);
    }, REAUTH_REDIRECT_DELAY_MS);

    return () => {
      clearInterval(tick);
      clearTimeout(timer);
    };
  }, [requiresReauth, reauthUrl]);

  const signOut = useCallback(async () => {
    // Clear local state immediately - don't wait for network
    clearAuthState();
    setRequiresReauth(false);
    setReauthMessage(null);
    setReauthCountdownSeconds(0);
    // Fire and forget the actual signout - if Supabase is slow, we don't care
    supabase.auth.signOut().catch(() => {});
  }, [supabase, clearAuthState]);

  useEffect(() => {
    if (!user?.id) {
      return;
    }

    if (globalRole === "super_admin") {
      return;
    }

    const timeoutMs =
      globalRole === "admin" ? ADMIN_IDLE_TIMEOUT_MS : STANDARD_IDLE_TIMEOUT_MS;
    const warningMs = globalRole === "admin" ? 0 : STANDARD_IDLE_WARNING_MS;

    idleTimeoutTriggeredRef.current = false;
    lastActivityAtRef.current = Date.now();

    const onActivity = () => {
      keepSessionAlive();
    };

    const events: (keyof WindowEventMap)[] = [
      "mousemove",
      "mousedown",
      "keydown",
      "scroll",
      "touchstart",
      "focus",
    ];

    events.forEach((eventName) =>
      window.addEventListener(eventName, onActivity, { passive: true })
    );

    const onVisibilityChange = () => {
      if (!document.hidden) {
        onActivity();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    const intervalId = window.setInterval(() => {
      if (idleTimeoutTriggeredRef.current) return;

      const remainingMs = timeoutMs - (Date.now() - lastActivityAtRef.current);
      if (remainingMs <= 0) {
        idleTimeoutTriggeredRef.current = true;
        setIdleWarningVisible(false);
        setIdleSecondsRemaining(0);
        signOut().finally(() => {
          void emitAuthTelemetry("auth_idle_timeout", {
            role: globalRole,
            timeoutMs,
            warningMs,
            path:
              typeof window !== "undefined"
                ? window.location.pathname
                : null,
          });
          window.location.assign("/login?reason=idle_timeout");
        });
        return;
      }

      if (warningMs > 0 && remainingMs <= warningMs) {
        setIdleWarningVisible(true);
        setIdleSecondsRemaining(Math.ceil(remainingMs / 1000));
      } else {
        setIdleWarningVisible(false);
        setIdleSecondsRemaining(0);
      }
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
      events.forEach((eventName) =>
        window.removeEventListener(eventName, onActivity)
      );
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [user?.id, globalRole, signOut, keepSessionAlive]);

  const refreshPermissions = useCallback(async () => {
    if (!user) return;

    for (let attempt = 1; attempt <= MAX_PERMISSION_RETRIES; attempt++) {
      try {
        await fetchUserData(user.id);
        return;
      } catch (err) {
        const isLastAttempt = attempt === MAX_PERMISSION_RETRIES;
        const errorDetails = describeError(err);
        const errorText =
          Object.keys(errorDetails).length > 0
            ? null
            : err instanceof Error
              ? err.message
              : String(err ?? "unknown error");
        console.warn("[AuthProvider] refreshPermissions attempt failed:", {
          attempt,
          isLastAttempt,
          err: errorDetails,
          errorText,
        });

        if (!isLastAttempt) {
          const delay = RETRY_BASE_MS * 2 ** (attempt - 1);
          await sleep(delay + Math.floor(Math.random() * 150));
        }
      }
    }
  }, [user, fetchUserData]);

  const effectivePermission = devOverride ?? permissionState;
  const effectiveSurveyParticipant =
    devSurveyParticipantOverride ?? isSurveyParticipant;

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      profile,
      globalRole,
      permissionState: effectivePermission,
      organizations,
      isLoading,
      decryptionKey,
      isSurveyParticipant: effectiveSurveyParticipant,
      isBenchmarkingReviewer,
      signOut,
      refreshPermissions,
      devOverride,
      setDevOverride,
      devSurveyParticipantOverride,
      setDevSurveyParticipantOverride,
      requiresReauth,
      reauthMessage,
      reauthUrl,
      reauthCountdownSeconds,
      idleWarningVisible,
      idleSecondsRemaining,
      keepSessionAlive,
    }),
    [
      user,
      profile,
      globalRole,
      effectivePermission,
      organizations,
      isLoading,
      decryptionKey,
      effectiveSurveyParticipant,
      isBenchmarkingReviewer,
      signOut,
      refreshPermissions,
      devOverride,
      devSurveyParticipantOverride,
      requiresReauth,
      reauthMessage,
      reauthUrl,
      reauthCountdownSeconds,
      idleWarningVisible,
      idleSecondsRemaining,
      keepSessionAlive,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
