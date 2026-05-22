import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getOptionalAuthContext } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Playbook | Campus Stores Canada",
  description: "Your CSC partner playbook — manage your presence, connect with members, and track your engagement.",
};

export default async function PlaybookPage() {
  const authCtx = await getOptionalAuthContext();
  const userId = authCtx?.userId ?? null;

  if (!userId) redirect("/login?next=/playbook");

  const db = createAdminClient();
  const { data: membershipRow } = await db
    .from("user_organizations")
    .select("organization_id, organizations(id, slug, name, type, updated_at)")
    .eq("user_id", userId)
    .eq("status", "active")
    .eq("organizations.type", "Vendor Partner")
    .limit(1)
    .maybeSingle();

  const org = (membershipRow?.organizations as {
    id: string; slug: string; name: string; type: string; updated_at: string | null;
  } | null);

  // Not a partner — send them somewhere sensible
  if (!org) redirect("/resources");

  const orgSlug = org.slug;
  const orgName = org.name;

  // Profile staleness
  const updatedAt = org.updated_at ? new Date(org.updated_at.replace(" ", "T") + "Z") : null;
  const monthsSinceUpdate = updatedAt
    ? Math.floor((Date.now() - updatedAt.getTime()) / (1000 * 60 * 60 * 24 * 30))
    : null;
  const profileStale = monthsSinceUpdate !== null && monthsSinceUpdate >= 12;

  return (
    <div className="min-h-screen bg-[#F9F9F9]">
      {/* Header */}
      <div className="bg-[#1A1A1A] py-12 md:py-16">
        <div className="max-w-5xl mx-auto px-6">
          <p className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-2">
            Your Playbook
          </p>
          <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tight">
            {orgName}
          </h1>
          <p className="text-[#9B9B9B] text-sm mt-2">
            Your hub for managing your CSC presence and connecting with the campus store network.
          </p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-12 space-y-10">

        {/* ── Signals strip (stub) ─────────────────────────────────────────── */}
        <div className="rounded-2xl border border-dashed border-[#D0D0D0] bg-white px-6 py-5">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0 mt-0.5">
              <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-700">
                Personalized signals coming soon
              </p>
              <p className="text-xs text-gray-400 mt-0.5 max-w-xl">
                We&rsquo;re building an intelligence layer that will surface timely observations about your
                engagement — new member stores in your category, Circle discussions you&rsquo;re missing,
                conference timing, and more. For now, your actions are below.
              </p>
            </div>
          </div>

          {/* Profile staleness is something we can show right now */}
          {profileStale && (
            <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between gap-4">
              <div className="flex items-start gap-2.5">
                <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0 mt-1.5" />
                <p className="text-sm text-gray-700">
                  Your partner profile hasn&rsquo;t been updated in{" "}
                  <span className="font-semibold">{monthsSinceUpdate} months</span>.
                  Members search the directory by category — is your listing still accurate?
                </p>
              </div>
              <Link
                href={`/org/${orgSlug}/edit`}
                className="flex-shrink-0 text-xs font-semibold text-[#163D6D] hover:underline"
              >
                Update profile →
              </Link>
            </div>
          )}
        </div>

        {/* ── Actions grid ─────────────────────────────────────────────────── */}
        <div>
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-4">
            Your Actions
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

            <ActionCard
              href={`/org/${orgSlug}`}
              icon={
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              }
              title="Your Partner Profile"
              description="How members see you in the directory. Keep your categories, contacts, and description current."
            />

            <ActionCard
              href="/members"
              icon={
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              }
              title="Browse Member Stores"
              description="Find campus stores by institution type, size, and province. Know your market."
            />

            <ActionCard
              href="/events"
              icon={
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              }
              title="Upcoming Events"
              description="Conference exhibition, webinars, and member events. See what's ahead and register."
            />

            <ActionCard
              href="https://memberspace.campusstores.ca"
              external
              icon={
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
              }
              title="Post in Community"
              description="Share updates, product news, or questions in the CSC member community on Circle."
            />

            <ActionCard
              href="/benchmarking"
              icon={
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              }
              title="Sector Benchmarking"
              description="Understand the market you're selling into — financial performance, size distribution, and operating models across Canadian campus stores."
            />

            <ActionCard
              href="/contact"
              icon={
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              }
              title="Contact CSC Staff"
              description="Questions about your partnership, membership renewal, or conference logistics."
            />

          </div>
        </div>

      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ActionCard({
  href,
  icon,
  title,
  description,
  external = false,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  external?: boolean;
}) {
  const inner = (
    <div className="flex items-start gap-4 p-5 bg-white rounded-xl border border-[#E5E5E5] hover:border-[#163D6D]/30 hover:shadow-sm transition-all h-full">
      <div className="w-9 h-9 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center flex-shrink-0">
        <svg className="w-4.5 h-4.5 text-[#163D6D]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
          {icon}
        </svg>
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-[#1A1A1A]">{title}</p>
        <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{description}</p>
      </div>
    </div>
  );

  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="block h-full">
        {inner}
      </a>
    );
  }

  return (
    <Link href={href} className="block h-full">
      {inner}
    </Link>
  );
}
