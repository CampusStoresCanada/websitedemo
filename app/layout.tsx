import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { AuthProvider } from "@/components/providers/AuthProvider";
import DevPanel from "@/components/dev/DevPanel";
import Toolkit, { ToolkitProvider } from "@/components/ui/Toolkit";
import FlagReviewPanel from "@/components/ui/FlagReviewPanel";
import ExplainContextPanel from "@/components/ui/ExplainContextPanel";
import InternalSharePanel from "@/components/ui/InternalSharePanel";
import PublicHighlightHandler from "@/components/ui/PublicHighlightHandler";
import BookmarkJumpHandler from "@/components/ui/BookmarkJumpHandler";
import { getServerAuthState } from "@/lib/auth/server";
import OnboardingGate from "@/components/layout/OnboardingGate";
import { getPlatformIdentity } from "@/lib/data";

export async function generateMetadata(): Promise<Metadata> {
  const identity = await getPlatformIdentity();
  return {
    title: `${identity.clientName} | Member & Partner Network`,
    description: `Connecting ${identity.clientName}'s members and partners with resources, partnerships, and expertise.`,
  };
}

// Hydrate client auth from server truth to avoid initial client-side auth drift.
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [serverAuth, identity] = await Promise.all([
    getServerAuthState(),
    getPlatformIdentity(),
  ]);
  const initialAuth = {
    user: serverAuth.user,
    profile: serverAuth.profile,
    globalRole: serverAuth.globalRole,
    permissionState: serverAuth.permissionState,
    organizations: serverAuth.organizations,
    programs: serverAuth.programs,
    // org_admin permissionState is already exactly "org_admin of a program
    // whose orgAdminElevates is true" (see derivePermissionState) — no need
    // to re-derive the same org-type check independently here.
    isSurveyParticipant:
      serverAuth.globalRole === "super_admin" ||
      serverAuth.globalRole === "admin" ||
      serverAuth.permissionState === "org_admin",
    isBenchmarkingReviewer: serverAuth.profile?.is_benchmarking_reviewer ?? false,
    isCancollMember: serverAuth.organizations.some(
      (uo) => uo.organization?.is_cancoll_member === true
    ),
  };

  // True for any user who has a qualifying persona (all 4 journeys)
  const serverHasOnboarding = serverAuth.user != null && serverAuth.organizations.length > 0;

  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href="https://use.typekit.net/uxh8ckq.css" />
      </head>
      <body className="antialiased">
        <AuthProvider key={serverAuth.user?.id ?? "anon"} initialAuth={initialAuth}>
          <ToolkitProvider>
            <Suspense><Header identity={identity} /></Suspense>
            <OnboardingGate serverHasOnboarding={serverHasOnboarding}>
              <main className="min-h-screen">{children}</main>
              <Footer />
              {process.env.NODE_ENV === "development" ? <DevPanel /> : null}
              <Toolkit googleMapsApiKey={process.env.GOOGLE_MAPS_API_KEY ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? null} />
              <Suspense><FlagReviewPanel /></Suspense>
              <Suspense><ExplainContextPanel /></Suspense>
              <Suspense><InternalSharePanel /></Suspense>
              <Suspense><PublicHighlightHandler /></Suspense>
              <Suspense><BookmarkJumpHandler /></Suspense>
            </OnboardingGate>
          </ToolkitProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
