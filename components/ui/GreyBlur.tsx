"use client";

import { useState, useEffect, createContext, useContext } from "react";
import Link from "next/link";
import { useAuth } from "@/components/providers/AuthProvider";
import { hasPermission } from "@/lib/auth/permissions";
import { decryptPayload } from "@/lib/auth/crypto";
import type { PermissionState, EncryptedField } from "@/lib/auth/types";

interface GreyBlurProps {
  /** Minimum permission level required to view this content */
  requiredPermission: PermissionState;
  /** Encrypted data field — when provided, content is decrypted on the client if authorized */
  encryptedField?: EncryptedField;
  /** Callback with decrypted data when user is authorized */
  onDecrypted?: (data: unknown) => void;
  /** Children to show (visible but blurred when unauthorized) */
  children?: React.ReactNode;
  /** Custom message to show when not authorized (defaults based on requiredPermission) */
  unauthorizedMessage?: string;
  /** Custom CTA text (defaults based on requiredPermission) */
  ctaText?: string;
  /** Custom CTA link (defaults based on requiredPermission) */
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
  const [decryptedData, setDecryptedData] = useState<unknown>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);

  // Special handling for survey_participant: requires both permission level AND survey participation
  const isAuthorized = !isLoading && (() => {
    if (requiredPermission === "survey_participant") {
      // For survey_participant, user needs org_admin level AND must have survey data
      return hasPermission(permissionState, "org_admin") && isSurveyParticipant;
    }
    return hasPermission(permissionState, requiredPermission);
  })();

  // Decrypt data when authorized and encrypted field is provided
  useEffect(() => {
    if (
      isAuthorized &&
      encryptedField &&
      decryptionKey &&
      !decryptedData &&
      !isDecrypting
    ) {
      setIsDecrypting(true);
      decryptPayload(encryptedField.encrypted, encryptedField.iv, decryptionKey)
        .then((data) => {
          setDecryptedData(data);
          onDecrypted?.(data);
          setIsDecrypting(false);
        })
        .catch((err) => {
          console.error("Decryption failed:", err);
          setIsDecrypting(false);
        });
    }
  }, [
    isAuthorized,
    encryptedField,
    decryptionKey,
    decryptedData,
    isDecrypting,
    onDecrypted,
  ]);

  // If authorized (or decrypted) — show content normally
  if (isAuthorized && (!encryptedField || decryptedData)) {
    return <>{children}</>;
  }

  // Determine the appropriate message and CTA based on permission type and user state
  const getUnauthorizedContent = () => {
    if (unauthorizedMessage && ctaText && ctaLink) {
      return { message: unauthorizedMessage, cta: ctaText, link: ctaLink };
    }

    // Special messaging for survey_participant content
    if (requiredPermission === "survey_participant") {
      if (!user) {
        return {
          message: "Sign in to access benchmarking data",
          cta: "Sign In",
          link: "/login",
        };
      }
      // User is logged in but their org hasn't completed the survey
      return {
        message: "Complete the annual benchmarking survey to access detailed financial comparisons with other member institutions",
        cta: "Learn More About the Survey",
        link: "/benchmarking-survey", // placeholder link
      };
    }

    // Default messaging for member-only content
    if (!user) {
      return {
        message: "This information is available to CSC members",
        cta: "Sign In",
        link: "/login",
      };
    }

    return {
      message: "This information is available to CSC members",
      cta: "Join CSC",
      link: "/signup",
    };
  };

  const { message, cta, link } = getUnauthorizedContent();

  // Not authorized or still loading/decrypting — show blurred content with CTA overlay
  return (
    <div className="relative">
      {/* Blurred content */}
      <div
        className="select-none"
        style={{
          filter: "blur(6px)",
          opacity: 0.5,
          pointerEvents: "none",
        }}
        aria-hidden="true"
      >
        {children}
      </div>

      {/* Overlay with CTA */}
      <div className="absolute inset-0 flex items-center justify-center bg-white/60 backdrop-blur-[2px]">
        <div className="text-center px-6 py-8 max-w-md">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-gray-100 flex items-center justify-center">
            <svg
              className="w-6 h-6 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          </div>
          <p className="text-gray-600 text-sm mb-4">{message}</p>
          <Link
            href={link}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#1A1A1A] text-white text-sm font-medium rounded-full hover:bg-gray-800 transition-colors"
          >
            {cta}
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
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
  /** Minimum permission level required to view values */
  requiredPermission: PermissionState;
  /** Children — use BlurredValue within to blur individual values */
  children: React.ReactNode;
  /** Custom message for the banner */
  bannerMessage?: string;
  /** Custom CTA text */
  ctaText?: string;
  /** Custom CTA link */
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
}: ProtectedSectionProps) {
  const { permissionState, isLoading, isSurveyParticipant, user } = useAuth();

  // Calculate hasPermission separately for debugging
  const permissionCheck = (() => {
    if (requiredPermission === "survey_participant") {
      return hasPermission(permissionState, "org_admin") && isSurveyParticipant;
    }
    return hasPermission(permissionState, requiredPermission);
  })();

  const isAuthorized = !isLoading && permissionCheck;

  // Debug log - remove after fixing
  console.log("[ProtectedSection]", {
    requiredPermission,
    permissionState,
    isLoading,
    permissionCheck,
    isAuthorized,
    userEmail: user?.email,
  });

  // Determine the appropriate message and CTA
  const getBannerContent = () => {
    if (bannerMessage && ctaText && ctaLink) {
      return { message: bannerMessage, cta: ctaText, link: ctaLink };
    }

    if (requiredPermission === "survey_participant") {
      if (!user) {
        return {
          message: "Sign in to view benchmarking data",
          cta: "Sign In",
          link: "/login",
        };
      }
      return {
        message: "Complete the annual survey to unlock full benchmarking data",
        cta: "Learn More",
        link: "/benchmarking-survey",
      };
    }

    if (!user) {
      return {
        message: "Sign in to view this information",
        cta: "Sign In",
        link: "/login",
      };
    }

    return {
      message: "This information is available to CSC members",
      cta: "Join CSC",
      link: "/signup",
    };
  };

  const { message, cta, link } = getBannerContent();

  return (
    <ProtectedSectionContext.Provider value={{ isAuthorized, requiredPermission }}>
      <div>
        {/* Banner when not authorized */}
        {!isAuthorized && (
          <div className="mb-6 p-4 bg-gradient-to-r from-gray-50 to-gray-100 border border-gray-200 rounded-lg flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-white shadow-sm flex items-center justify-center flex-shrink-0">
                <svg
                  className="w-5 h-5 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                  />
                </svg>
              </div>
              <p className="text-sm text-gray-600">{message}</p>
            </div>
            <Link
              href={link}
              className="flex-shrink-0 px-4 py-2 bg-[#1A1A1A] text-white text-sm font-medium rounded-full hover:bg-gray-800 transition-colors"
            >
              {cta}
            </Link>
          </div>
        )}

        {/* Content with structure visible */}
        {children}
      </div>
    </ProtectedSectionContext.Provider>
  );
}

// =============================================================================
// BlurredValue — Individual value that gets blurred when in unauthorized context
// =============================================================================

interface BlurredValueProps {
  /** The actual value to display (or blur) */
  children: React.ReactNode;
  /** Placeholder width when blurred (in characters, roughly) */
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

  // When unauthorized, render a placeholder instead of the actual content
  // This prevents data leakage (e.g., email addresses in mailto: links)
  // We use a visually similar placeholder that maintains approximate layout
  const placeholder = "•".repeat(placeholderWidth);

  return (
    <span
      className="select-none inline-block"
      style={{
        filter: "blur(4px)",
        color: "#9ca3af", // Gray placeholder color
        letterSpacing: "0.1em",
      }}
      aria-hidden="true"
    >
      {placeholder}
    </span>
  );
}

/**
 * Renders placeholder blocks that mimic the structure of hidden content.
 * Used when you want structured placeholders instead of actual blurred data.
 */
export function PlaceholderBlocks({
  count,
  fieldWidths,
  type = "default",
}: {
  count: number;
  fieldWidths: number[];
  type?: string;
}) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          {type === "contact" && (
            <div className="w-10 h-10 rounded-full bg-gray-200 flex-shrink-0" />
          )}
          <div className="space-y-1.5 flex-1">
            <div
              className="h-3.5 bg-gray-200 rounded"
              style={{ width: `${fieldWidths[i % fieldWidths.length]}px` }}
            />
            <div
              className="h-3 bg-gray-100 rounded"
              style={{
                width: `${(fieldWidths[i % fieldWidths.length] * 0.7).toFixed(0)}px`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
