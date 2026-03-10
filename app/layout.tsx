import type { Metadata } from "next";
import "./globals.css";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { AuthProvider } from "@/components/providers/AuthProvider";
import DevPanel from "@/components/dev/DevPanel";
import Toolkit, { ToolkitProvider } from "@/components/ui/Toolkit";
import { getServerAuthState } from "@/lib/auth/server";

export const metadata: Metadata = {
  title: "Campus Stores Canada | Canada's Campus Store Network",
  description:
    "Connecting 70 campus stores coast-to-coast with resources, partnerships, and expertise.",
};

// Hydrate client auth from server truth to avoid initial client-side auth drift.
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const serverAuth = await getServerAuthState();
  const initialAuth = {
    user: serverAuth.user,
    profile: serverAuth.profile,
    globalRole: serverAuth.globalRole,
    permissionState: serverAuth.permissionState,
    organizations: serverAuth.organizations,
    isSurveyParticipant:
      serverAuth.globalRole === "super_admin" ||
      serverAuth.globalRole === "admin" ||
      serverAuth.organizations.some(
        (uo) => uo.role === "org_admin" && uo.organization?.type === "Member"
      ),
    isBenchmarkingReviewer: serverAuth.profile?.is_benchmarking_reviewer ?? false,
  };

  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href="https://use.typekit.net/uxh8ckq.css" />
      </head>
      <body className="antialiased">
        <AuthProvider key={serverAuth.user?.id ?? "anon"} initialAuth={initialAuth}>
          <ToolkitProvider>
            <Header />
            <main className="min-h-screen">{children}</main>
            <Footer />
            {process.env.NODE_ENV === "development" ? <DevPanel /> : null}
            <Toolkit />
          </ToolkitProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
