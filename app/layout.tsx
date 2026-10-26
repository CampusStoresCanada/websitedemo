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
import { ViewBeacon } from "@/components/signals/ViewBeacon";
import { getPlatformIdentity } from "@/lib/data";
import { canPauseCircleBadge, isCircleBadgePaused } from "@/lib/circle/badge-preference";
import PresentationIndicator from "@/components/presentation/PresentationIndicator";
import { getPresentationModeForViewer } from "@/lib/visibility/viewer";
import { headers } from "next/headers";
import { isEmbedded } from "@/lib/admin/nav";
import { REQUEST_SEARCH_HEADER } from "@/lib/auth/request-path";

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

  // Resolved from the same memoized auth context the pages below mask against,
  // so neither the indicator bar nor any client affordance can claim a level
  // the server-rendered content disagrees with. Null for every account that is
  // not CSC staff, and for staff who have not turned it on.
  const presentationLevel = await getPresentationModeForViewer();

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
    isBenchmarkingReviewer: serverAuth.isBenchmarkingReviewer,
    isBenchmarkingContentReviewer: serverAuth.isBenchmarkingContentReviewer,
    isCancollMember: serverAuth.organizations.some(
      (uo) => uo.organization?.is_cancoll_member === true,
    ),
    // Display only. permissionState above is deliberately left at its real
    // value so staff keep every edit right while presenting.
    presentationMode: presentationLevel,
  };

  // Personal off-switch for the Circle badge poll. Seeded server-side so a
  // paused account never fires the first poll on load; isCircleBadgePaused()
  // returns false without touching the database for anyone not allow-listed.
  const showCirclePauseToggle = canPauseCircleBadge(serverAuth.user?.email);
  const circleBadgePaused = serverAuth.user
    ? await isCircleBadgePaused(serverAuth.user.id, serverAuth.user.email ?? null)
    : false;

  // True for any user who has a qualifying persona (all 4 journeys)

  const serverHasOnboarding = serverAuth.user != null && serverAuth.organizations.length > 0;

  // A print sheet inside a War Room Preview (`?embed=1`): the sheet alone, no
  // header, footer or toolkit. The search is only stamped on gated areas
  // (proxy.ts), so this cannot strip chrome from a public page.
  if (isEmbedded((await headers()).get(REQUEST_SEARCH_HEADER) ?? "")) {
    return (
      <html lang="en">
        <head>
          <link rel="stylesheet" href="https://use.typekit.net/uxh8ckq.css" />
        </head>
        <body className="antialiased bg-white">
          <AuthProvider key={serverAuth.user?.id ?? "anon"} initialAuth={initialAuth}>
            <main>{children}</main>
          </AuthProvider>
        </body>
      </html>
    );
  }


  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href="https://use.typekit.net/uxh8ckq.css" />
      </head>
      <body className="antialiased">
        <AuthProvider
          key={serverAuth.user?.id ?? "anon"}
          initialAuth={initialAuth}
        >
          <ToolkitProvider>
            <Suspense>
              <Header
                identity={identity}
                circleBadgePaused={circleBadgePaused}
                showCirclePauseToggle={showCirclePauseToggle}
              />
            </Suspense>
            <OnboardingGate serverHasOnboarding={serverHasOnboarding}>
              <main className="min-h-screen">{children}</main>
              <Footer />
              {process.env.NODE_ENV === "development" ? <DevPanel /> : null}
              <Toolkit
                googleMapsApiKey={
                  process.env.GOOGLE_MAPS_API_KEY ??
                  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ??
                  null
                }
              />
              <Suspense>
                <FlagReviewPanel />
              </Suspense>
              <Suspense>
                <ExplainContextPanel />
              </Suspense>
              <Suspense>
                <InternalSharePanel />
              </Suspense>
              <Suspense>
                <PublicHighlightHandler />
              </Suspense>
              <Suspense>
                <BookmarkJumpHandler />
              </Suspense>
              {/*
                ⛔ THE SWITCH. Mounting this turns on site-wide behavioural
                capture: for a signed-in member every navigation reports the
                path they landed on and the one they came from.

                Turned on deliberately on 2026-10-16, to give the match engine
                the one signal the platform never collected — the quiet half,
                what somebody looked at rather than what they chose to publish.

                ⚠️ Switched on BEFORE any consumer exists, on purpose. Nothing
                reads page_views yet. The data is only worth something with a
                history behind it, so collecting early means the reader has
                months of signal when it is built rather than starting at zero.

                What is NOT recorded lives in lib/signals/page-view.ts and the
                rules there are load-bearing: /admin never, query params by
                allow-list rather than block-list, uuid-only paths dropped.
              */}
              <Suspense>
                <ViewBeacon />
              </Suspense>
              {presentationLevel ? (
                <PresentationIndicator level={presentationLevel} />
              ) : null}
            </OnboardingGate>
          </ToolkitProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
