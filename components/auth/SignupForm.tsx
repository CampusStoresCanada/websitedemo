"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type SignupStep = "email" | "org-select" | "profile" | "confirmation";

interface OrgMatch {
  id: string;
  name: string;
  type: string;
  slug: string;
  logo_url: string | null;
}

export default function SignupForm() {
  const [step, setStep] = useState<SignupStep>("email");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Org matching
  const [domainMatches, setDomainMatches] = useState<OrgMatch[]>([]);
  const [allOrgs, setAllOrgs] = useState<OrgMatch[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<OrgMatch | null>(null);
  const [orgSearch, setOrgSearch] = useState("");
  const [showOrgSearch, setShowOrgSearch] = useState(false);

  // Final state
  const [confirmationMessage, setConfirmationMessage] = useState("");

  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  // Step 1: Email → domain hint lookup
  const handleEmailSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setIsLoading(true);
      setError(null);

      const domain = email.split("@")[1];

      // Fetch orgs matching the email domain + all orgs for manual selection
      const [domainResult, allOrgsResult] = await Promise.all([
        supabase
          .from("organizations")
          .select("id, name, type, slug, logo_url")
          .eq("email_domain", domain)
          .is("archived_at", null),
        supabase
          .from("organizations")
          .select("id, name, type, slug, logo_url")
          .is("archived_at", null)
          .order("name"),
      ]);

      const matches = (domainResult.data as OrgMatch[]) || [];
      const all = (allOrgsResult.data as OrgMatch[]) || [];

      setDomainMatches(matches);
      setAllOrgs(all);
      setIsLoading(false);

      if (matches.length === 1) {
        // Single match — auto-select and go to profile
        setSelectedOrg(matches[0]);
        setStep("org-select");
      } else if (matches.length > 1) {
        // Multiple matches — let them pick
        setStep("org-select");
      } else {
        // No match — show org selection
        setStep("org-select");
      }
    },
    [email, supabase]
  );

  // Step 3: Create account + submit application
  const handleSignup = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);

      if (password !== confirmPassword) {
        setError("Passwords do not match");
        return;
      }

      if (password.length < 8) {
        setError("Password must be at least 8 characters");
        return;
      }

      setIsLoading(true);

      // Create the Supabase auth account
      const { data: authData, error: signUpError } =
        await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: displayName },
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        });

      if (signUpError) {
        setError(signUpError.message);
        setIsLoading(false);
        return;
      }

      // If we have a selected org, create an application
      if (selectedOrg && authData.user) {
        const { error: appError } = await supabase
          .from("signup_applications")
          .insert({
            user_id: authData.user.id,
            organization_id: selectedOrg.id,
            status: "pending",
            application_type: "join_existing" as const,
            application_data: {
              email,
              display_name: displayName,
              org_name: selectedOrg.name,
            },
          });

        if (appError) {
          console.error("Application creation error:", appError);
          // Don't block — account was created, application can be retried
        }

        setConfirmationMessage(
          `Your account has been created and your request to join ${selectedOrg.name} has been submitted. An administrator will review your application.`
        );
      } else {
        setConfirmationMessage(
          "Your account has been created. Please check your email to verify your address."
        );
      }

      setIsLoading(false);
      setStep("confirmation");
    },
    [email, password, confirmPassword, displayName, selectedOrg, supabase]
  );

  // Filter orgs for search
  const filteredOrgs = orgSearch
    ? allOrgs.filter((org) =>
        org.name.toLowerCase().includes(orgSearch.toLowerCase())
      )
    : allOrgs;

  // --- STEP RENDERS ---

  if (step === "confirmation") {
    return (
      <div className="text-center py-6">
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-green-50 flex items-center justify-center">
          <svg
            className="w-8 h-8 text-green-500"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
            />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">
          You&apos;re all set!
        </h2>
        <p className="text-gray-600 text-sm mb-6">{confirmationMessage}</p>
        <p className="text-xs text-gray-500 mb-6">
          Check your email to verify your address and complete setup.
        </p>
        <Link
          href="/login"
          className="inline-flex items-center justify-center px-6 py-2.5 bg-[#EE2A2E] text-white text-sm font-medium rounded-lg hover:bg-[#D92327] transition-colors"
        >
          Go to Login
        </Link>
      </div>
    );
  }

  return (
    <div>
      {/* Step indicator */}
      <div className="flex items-center justify-center gap-2 mb-6">
        {["email", "org-select", "profile"].map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium ${
                step === s
                  ? "bg-[#EE2A2E] text-white"
                  : ["email", "org-select", "profile"].indexOf(step) > i
                    ? "bg-green-100 text-green-700"
                    : "bg-gray-100 text-gray-400"
              }`}
            >
              {["email", "org-select", "profile"].indexOf(step) > i ? (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
              ) : (
                i + 1
              )}
            </div>
            {i < 2 && (
              <div
                className={`w-8 h-0.5 ${
                  ["email", "org-select", "profile"].indexOf(step) > i
                    ? "bg-green-300"
                    : "bg-gray-200"
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Step 1: Email */}
      {step === "email" && (
        <form onSubmit={handleEmailSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="signup-email"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Work or institutional email
            </label>
            <input
              id="signup-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/20 focus:border-[#EE2A2E] transition-colors"
              placeholder="you@yourschool.ca"
            />
            <p className="mt-1.5 text-xs text-gray-500">
              Use your organization email so we can match you to your institution
              or company.
            </p>
          </div>
          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2.5 bg-[#EE2A2E] text-white text-sm font-medium rounded-lg hover:bg-[#D92327] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? "Looking up your organization..." : "Continue"}
          </button>
        </form>
      )}

      {/* Step 2: Org Selection */}
      {step === "org-select" && (
        <div className="space-y-4">
          {domainMatches.length > 0 ? (
            <>
              <p className="text-sm text-gray-600">
                {domainMatches.length === 1
                  ? "We found your organization:"
                  : "We found organizations matching your email domain:"}
              </p>
              <div className="space-y-2">
                {domainMatches.map((org) => (
                  <button
                    key={org.id}
                    onClick={() => {
                      setSelectedOrg(org);
                      setStep("profile");
                    }}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                      selectedOrg?.id === org.id
                        ? "border-[#EE2A2E] bg-red-50"
                        : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    {org.logo_url ? (
                      <img
                        src={org.logo_url}
                        alt=""
                        className="w-10 h-10 rounded object-contain bg-white"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded bg-gray-100 flex items-center justify-center text-gray-400 text-xs font-medium">
                        {org.name.charAt(0)}
                      </div>
                    )}
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {org.name}
                      </p>
                      <p className="text-xs text-gray-500">{org.type}</p>
                    </div>
                  </button>
                ))}
              </div>
              <button
                onClick={() => setShowOrgSearch(true)}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Not your organization? Search for it
              </button>
            </>
          ) : (
            <div>
              <p className="text-sm text-gray-600 mb-3">
                We couldn&apos;t automatically match your email to an
                organization. Search for yours below:
              </p>
              {renderOrgSearch()}
            </div>
          )}

          {showOrgSearch && domainMatches.length > 0 && renderOrgSearch()}

          {/* No org path */}
          <div className="pt-4 border-t border-gray-200">
            <p className="text-xs text-gray-500 mb-2">
              Not part of a CSC member or partner yet?
            </p>
            <button
              onClick={() => {
                setSelectedOrg(null);
                setStep("profile");
              }}
              className="text-sm text-[#EE2A2E] hover:text-[#D92327] font-medium"
            >
              Apply to join CSC →
            </button>
          </div>

          <button
            onClick={() => {
              setStep("email");
              setError(null);
            }}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            ← Back
          </button>
        </div>
      )}

      {/* Step 3: Profile Details */}
      {step === "profile" && (
        <form onSubmit={handleSignup} className="space-y-4">
          {selectedOrg && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 border border-gray-200 mb-2">
              {selectedOrg.logo_url ? (
                <img
                  src={selectedOrg.logo_url}
                  alt=""
                  className="w-8 h-8 rounded object-contain bg-white"
                />
              ) : (
                <div className="w-8 h-8 rounded bg-gray-200 flex items-center justify-center text-gray-500 text-xs font-medium">
                  {selectedOrg.name.charAt(0)}
                </div>
              )}
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {selectedOrg.name}
                </p>
                <p className="text-xs text-gray-500">
                  Joining as {selectedOrg.type}
                </p>
              </div>
            </div>
          )}

          <div>
            <label
              htmlFor="display-name"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Full name
            </label>
            <input
              id="display-name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              autoComplete="name"
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/20 focus:border-[#EE2A2E] transition-colors"
              placeholder="Jane Smith"
            />
          </div>
          <div>
            <label
              htmlFor="signup-password"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Password
            </label>
            <input
              id="signup-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/20 focus:border-[#EE2A2E] transition-colors"
              placeholder="At least 8 characters"
            />
          </div>
          <div>
            <label
              htmlFor="confirm-password"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Confirm password
            </label>
            <input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              autoComplete="new-password"
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/20 focus:border-[#EE2A2E] transition-colors"
              placeholder="Confirm your password"
            />
          </div>

          {!selectedOrg && (
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
              <p className="text-xs text-amber-800">
                You&apos;re signing up without an organization. After creating
                your account, you&apos;ll be able to apply to become a CSC member
                or partner.
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2.5 bg-[#EE2A2E] text-white text-sm font-medium rounded-lg hover:bg-[#D92327] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? "Creating account..." : "Create Account"}
          </button>

          <button
            type="button"
            onClick={() => {
              setStep("org-select");
              setError(null);
            }}
            className="w-full text-sm text-gray-500 hover:text-gray-700"
          >
            ← Back
          </button>
        </form>
      )}

      {/* Sign in link - always shown (confirmation step returns early above) */}
      <div className="mt-6 pt-6 border-t border-gray-200 text-center">
          <p className="text-sm text-gray-600">
            Already have an account?{" "}
            <Link
              href="/login"
              className="text-[#EE2A2E] hover:text-[#D92327] font-medium"
            >
              Sign in
            </Link>
          </p>
        </div>
    </div>
  );

  function renderOrgSearch() {
    return (
      <div className="space-y-2">
        <input
          type="text"
          value={orgSearch}
          onChange={(e) => setOrgSearch(e.target.value)}
          placeholder="Search organizations..."
          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/20 focus:border-[#EE2A2E] transition-colors"
        />
        <div className="max-h-48 overflow-y-auto space-y-1 rounded-lg border border-gray-200">
          {filteredOrgs.length === 0 ? (
            <p className="p-3 text-sm text-gray-500 text-center">
              No organizations found
            </p>
          ) : (
            filteredOrgs.map((org) => (
              <button
                key={org.id}
                onClick={() => {
                  setSelectedOrg(org);
                  setShowOrgSearch(false);
                  setStep("profile");
                }}
                className="w-full flex items-center gap-3 p-2.5 text-left hover:bg-gray-50 transition-colors"
              >
                {org.logo_url ? (
                  <img
                    src={org.logo_url}
                    alt=""
                    className="w-8 h-8 rounded object-contain bg-white"
                  />
                ) : (
                  <div className="w-8 h-8 rounded bg-gray-100 flex items-center justify-center text-gray-400 text-xs">
                    {org.name.charAt(0)}
                  </div>
                )}
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {org.name}
                  </p>
                  <p className="text-xs text-gray-500">{org.type}</p>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    );
  }
}
