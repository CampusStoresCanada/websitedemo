"use client";

import { useState, useEffect, createContext, useContext } from "react";
import Link from "next/link";
import { useAuth } from "@/components/providers/AuthProvider";
import { hasPermission } from "@/lib/auth/permissions";
import { hadPriorSession } from "@/lib/auth/persona-cookie";
import { decryptPayload } from "@/lib/auth/crypto";
import type { PermissionState, EncryptedField } from "@/lib/auth/types";

// ─── Page owner context ────────────────────────────────────────────────────────
// When a user is the org admin of the page they're viewing, wrap the page in
// <PageOwnerProvider> so ProtectedSection bypasses permission checks entirely.
// This lets a partner org admin see all content on their own profile page.
const PageOwnerContext = createContext(false);
export function PageOwnerProvider({ children, isOwner }: { children: React.ReactNode; isOwner: boolean }) {
  return <PageOwnerContext.Provider value={isOwner}>{children}</PageOwnerContext.Provider>;
}
export function useIsPageOwner() { return useContext(PageOwnerContext); }
// ──────────────────────────────────────────────────────────────────────────────

// =============================================================================
// Shared viewer-state hook
// =============================================================================

/**
 * The four access states used across all gated content UI.
 *
 *   new_visitor   — no session cookie; never signed in (acquisition target)
 *   returning     — has session cookie but currently signed out
 *   partner       — signed in, but partner-level; can't access member content
 *   insufficient  — signed in, but below the required permission for this content
 */
type ViewerGateState = "new_visitor" | "returning" | "partner" | "insufficient";

function useViewerGateState(user: ReturnType<typeof useAuth>["user"]): ViewerGateState {
  const { permissionState } = useAuth();
  const [hadSession, setHadSession] = useState(false);

  useEffect(() => {
    setHadSession(hadPriorSession());
  }, []);

  if (!user) {
    return hadSession ? "returning" : "new_visitor";
  }
  if (permissionState === "partner") return "partner";
  return "insufficient";
}

/**
 * Derives the banner content for a gated section based on viewer state.
 *
 * Returns `null` for the `partner` state — the UI shows an informational
 * message without a CTA, since there's no action a partner can take.
 */
function getGatedContent(state: ViewerGateState): {
  message: string;
  cta: string | null;
  link: string | null;
  /** Second, lower-emphasis option — used for new_visitor since we can't
   * tell a brand-new prospect apart from an existing member who's never
   * logged in on this browser (no session cookie either way). */
  secondaryCta: string | null;
  secondaryLink: string | null;
} {
  switch (state) {
    case "new_visitor":
      return {
        message: "This content is available to CSC member stores.",
        cta: "Become a Member",
        link: "/membership",
        secondaryCta: "Sign In",
        secondaryLink: "/login",
      };
    case "returning":
      return {
        message: "Sign in to access member content.",
        cta: "Sign In",
        link: "/login",
        secondaryCta: null,
        secondaryLink: null,
      };
    case "partner":
      return {
        message: "This content is for member stores only.",
        cta: null,
        link: null,
        secondaryCta: null,
        secondaryLink: null,
      };
    case "insufficient":
      return {
        message: "This content is available to CSC member stores.",
        cta: "Become a Member",
        link: "/membership",
        secondaryCta: null,
        secondaryLink: null,
      };
  }
}

// =============================================================================
// GreyBlur — Blurs content with a centred overlay CTA when unauthorized
// =============================================================================

interface GreyBlurProps {
  /** Minimum permission level required to view this content */
  requiredPermission: PermissionState;
  /** Encrypted data field — when provided, content is decrypted on the client if authorized */
  encryptedField?: EncryptedField;
  /** Callback with decrypted data when user is authorized */
  onDecrypted?: (data: unknown) => void;
  /** Children to show (visible but blurred when unauthorized) */
  children?: React.ReactNode;
  /** Override the default message (all three must be provided to take effect) */
  unauthorizedMessage?: string;
  ctaText?: string;
  ctaLink?: string;
}

export default function GreyBlur({
  requiredPermission,
  encryptedField,
  onDecrypted,
  children,
  unauthorizedMessage,
  ctaText,
  ctaLink,
}: GreyBlurProps) {
  const { permissionState, isLoading, decryptionKey, isSurveyParticipant, user } = useAuth();
  const isPageOwner = useIsPageOwner();
  const [decryptedData, setDecryptedData] = useState<unknown>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const gateState = useViewerGateState(user);

  const isAuthorized = isPageOwner || (!isLoading && (() => {
    if (requiredPermission === "survey_participant") {
      return hasPermission(permissionState, "org_admin") && isSurveyParticipant;
    }
    return hasPermission(permissionState, requiredPermission);
  })());

  useEffect(() => {
    if (isAuthorized && encryptedField && decryptionKey && !decryptedData && !isDecrypting) {
      setIsDecrypting(true);
      decryptPayload(encryptedField.encrypted, encryptedField.iv, decryptionKey)
        .then((data) => { setDecryptedData(data); onDecrypted?.(data); setIsDecrypting(false); })
        .catch((err) => { console.error("Decryption failed:", err); setIsDecrypting(false); });
    }
  }, [isAuthorized, encryptedField, decryptionKey, decryptedData, isDecrypting, onDecrypted]);

  if (isAuthorized && (!encryptedField || decryptedData)) {
    return <>{children}</>;
  }

  // Resolve message + CTA
  let message: string;
  let cta: string | null;
  let link: string | null;
  let secondaryCta: string | null = null;
  let secondaryLink: string | null = null;

  if (unauthorizedMessage && ctaText && ctaLink) {
    // Caller override — used for survey_participant custom flows
    message = unauthorizedMessage;
    cta = ctaText;
    link = ctaLink;
  } else if (requiredPermission === "survey_participant") {
    if (!user) {
      message = "Sign in to access benchmarking data";
      cta = "Sign In";
      link = "/login";
    } else {
      message = "Complete the annual benchmarking survey to access detailed financial comparisons";
      cta = "Learn More About the Survey";
      link = "/benchmarking-survey";
    }
  } else {
    const content = getGatedContent(gateState);
    message = content.message;
    cta = content.cta;
    link = content.link;
    secondaryCta = content.secondaryCta;
    secondaryLink = content.secondaryLink;
  }

  return (
    <div className="relative">
      <div
        className="select-none"
        style={{ filter: "blur(6px)", opacity: 0.5, pointerEvents: "none" }}
        aria-hidden="true"
      >
        {children}
      </div>
      <div className="absolute inset-0 flex items-center justify-center bg-white/60 backdrop-blur-[2px]">
        <div className="text-center px-6 py-8 max-w-md">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-gray-100 flex items-center justify-center">
            <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <p className="text-gray-600 text-sm mb-4">{message}</p>
          {cta && link && (
            <Link
              href={link}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#1A1A1A] text-white text-sm font-medium rounded-full hover:bg-gray-800 transition-colors"
            >
              {cta}
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          )}
          {secondaryCta && secondaryLink && (
            <Link
              href={secondaryLink}
              className="block mt-3 text-sm text-gray-500 hover:text-gray-700"
            >
              {secondaryCta}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// ProtectedSection — Shows structure but blurs values, with a banner CTA
// =============================================================================

interface ProtectedSectionContextValue {
  isAuthorized: boolean;
  requiredPermission: PermissionState;
}

const ProtectedSectionContext = createContext<ProtectedSectionContextValue>({
  isAuthorized: false,
  requiredPermission: "member",
});

export function useProtectedSection() {
  return useContext(ProtectedSectionContext);
}

interface ProtectedSectionProps {
  requiredPermission: PermissionState;
  children: React.ReactNode;
  /** Override banner content — all three must be provided to take effect */
  bannerMessage?: string;
  ctaText?: string;
  ctaLink?: string;
}

/**
 * Wraps a section where structure (headers, labels) stays visible
 * but actual values are blurred when unauthorized.
 * Use <BlurredValue> inside to mark which values should be protected.
 */
export function ProtectedSection({
  requiredPermission,
  children,
  bannerMessage,
  ctaText,
  ctaLink,
  bypass = false,
}: ProtectedSectionProps & { bypass?: boolean }) {
  const { permissionState, isLoading, isSurveyParticipant, user } = useAuth();
  const isPageOwner = useIsPageOwner();
  const gateState = useViewerGateState(user);

  const isAuthorized = bypass || isPageOwner || (!isLoading && (() => {
    if (requiredPermission === "survey_participant") {
      return hasPermission(permissionState, "org_admin") && isSurveyParticipant;
    }
    return hasPermission(permissionState, requiredPermission);
  })());

  // Resolve banner content
  let message: string;
  let cta: string | null;
  let link: string | null;
  let secondaryCta: string | null = null;
  let secondaryLink: string | null = null;

  if (bannerMessage && ctaText && ctaLink) {
    message = bannerMessage;
    cta = ctaText;
    link = ctaLink;
  } else if (requiredPermission === "survey_participant") {
    if (!user) {
      message = "Sign in to view benchmarking data";
      cta = "Sign In";
      link = "/login";
    } else {
      message = "Complete the annual survey to unlock full benchmarking data";
      cta = "Learn More";
      link = "/benchmarking-survey";
    }
  } else {
    const content = getGatedContent(gateState);
    message = content.message;
    cta = content.cta;
    link = content.link;
    secondaryCta = content.secondaryCta;
    secondaryLink = content.secondaryLink;
  }

  return (
    <ProtectedSectionContext.Provider value={{ isAuthorized, requiredPermission }}>
      <div>
        {!isAuthorized && (
          <div className="mb-6 p-4 bg-gradient-to-r from-gray-50 to-gray-100 border border-gray-200 rounded-lg flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-white shadow-sm flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <p className="text-sm text-gray-600">{message}</p>
            </div>
            <div className="flex-shrink-0 flex items-center gap-3">
              {secondaryCta && secondaryLink && (
                <Link href={secondaryLink} className="text-sm text-gray-500 hover:text-gray-700">
                  {secondaryCta}
                </Link>
              )}
              {cta && link && (
                <Link
                  href={link}
                  className="px-4 py-2 bg-[#1A1A1A] text-white text-sm font-medium rounded-full hover:bg-gray-800 transition-colors"
                >
                  {cta}
                </Link>
              )}
            </div>
          </div>
        )}
        {children}
      </div>
    </ProtectedSectionContext.Provider>
  );
}

// =============================================================================
// BlurredValue — Individual value that gets blurred when in unauthorized context
// =============================================================================

interface BlurredValueProps {
  children: React.ReactNode;
  placeholderWidth?: number;
}

/**
 * Renders a value that is blurred when inside an unauthorized ProtectedSection.
 * Shows the actual value when authorized.
 *
 * IMPORTANT: When unauthorized, we render a placeholder instead of the actual
 * content to prevent data leakage (e.g., mailto: links in the DOM).
 */
export function BlurredValue({ children, placeholderWidth = 12 }: BlurredValueProps) {
  const { isAuthorized } = useProtectedSection();

  if (isAuthorized) {
    return <>{children}</>;
  }

  // Render a blurred placeholder — never put actual data in the DOM when unauthorized
  return (
    <span
      className="inline-block rounded bg-gray-200 select-none"
      style={{ width: `${placeholderWidth * 0.6}em`, height: "1em", verticalAlign: "middle" }}
      aria-hidden="true"
    />
  );
}

