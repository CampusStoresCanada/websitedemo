"use client";

import Link from "next/link";
import { useAuth } from "@/components/providers/AuthProvider";
import { hasPermission } from "@/lib/auth/permissions";

/**
 * Below-fold CTA section for /members and /partners pages.
 * Auth-aware: logged-in members see a dashboard link instead of join.
 */
export default function DirectoryJoinCTA() {
  const { user, permissionState } = useAuth();
  const isMember = !!user && hasPermission(permissionState, "member");

  return (
    <section className="py-24 md:py-32">
      <div className="max-w-7xl mx-auto px-6 text-center">
        {isMember ? (
          <>
            <h2 className="text-4xl md:text-5xl font-bold text-[#1A1A1A] tracking-tight mb-6">
              Welcome back.
            </h2>
            <p className="text-xl text-[#6B6B6B] max-w-2xl mx-auto mb-10">
              Access your dashboard to manage your store profile, benchmarking
              data, and connect with peers.
            </p>
            <Link
              href="/dashboard"
              className="h-14 px-8 bg-[#1A1A1A] hover:bg-gray-800 text-white text-lg font-medium rounded-full transition-all hover:shadow-lg inline-flex items-center justify-center"
            >
              Go to Dashboard
            </Link>
          </>
        ) : (
          <>
            <h2 className="text-4xl md:text-5xl font-bold text-[#1A1A1A] tracking-tight mb-6">
              Ready to join the network?
            </h2>
            <p className="text-xl text-[#6B6B6B] max-w-2xl mx-auto mb-10">
              Connect with campus stores across Canada. Share resources, build
              partnerships, and grow together.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/apply/member"
                className="h-14 px-8 bg-[#EE2A2E] hover:bg-[#D92327] text-white text-lg font-medium rounded-full transition-all hover:shadow-lg hover:shadow-red-500/25 inline-flex items-center justify-center"
              >
                Become a Member
              </Link>
              <Link
                href="/apply/partner"
                className="h-14 px-8 bg-white hover:bg-slate-50 text-[#1A1A1A] text-lg font-medium rounded-full border border-[#E5E5E5] transition-all hover:border-[#D4D4D4] inline-flex items-center justify-center"
              >
                Partner With Us
              </Link>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
