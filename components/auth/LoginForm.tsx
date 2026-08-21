"use client";

import { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Mode = "password" | "code_request" | "code_entry";

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<Mode>("password");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createClient(), []);
  const rawNext = searchParams.get("next");
  const nextPath = rawNext && rawNext.startsWith("/") ? rawNext : "/";

  useEffect(() => {
    if (!rawNext) return;
    const normalized = rawNext.toLowerCase();
    const loopDetected =
      normalized.startsWith("/login") || normalized.includes("next=/login");
    if (!loopDetected) return;
    void fetch("/api/telemetry/auth-event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      keepalive: true,
      body: JSON.stringify({
        event: "auth_login_redirect_loop",
        details: { rawNext, normalizedNext: nextPath },
      }),
    }).catch(() => {});
  }, [rawNext, nextPath]);

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setIsLoading(false);
      return;
    }

    window.location.assign(nextPath);
  };

  /**
   * Request a 6-digit sign-in code.
   *
   * Deliberately a CODE, not a magic link. Exchange/Outlook Safe Links
   * pre-fetches URLs in inbound mail, which silently burns single-use auth
   * links before the human ever clicks — we already hit exactly this on
   * password reset and moved that flow to typed codes for the same reason
   * (see app/reset-password/page.tsx). A code that lives in someone's eyes
   * cannot be consumed by a scanner, and it works cross-device, since there
   * is no PKCE verifier pinned to the requesting browser.
   *
   * `shouldCreateUser: false` matters: this is a sign-in surface, not a
   * signup one. Without it Supabase would silently mint an account for any
   * address typed here.
   */
  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setNotice(null);

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false },
    });

    // Never reveal whether an address has an account — same posture as
    // account recovery. Advance to code entry either way.
    if (error && !/rate|limit|seconds/i.test(error.message)) {
      setMode("code_entry");
      setNotice("If that address has an account, a sign-in code is on its way.");
      setIsLoading(false);
      return;
    }
    if (error) {
      setError(error.message);
      setIsLoading(false);
      return;
    }

    setMode("code_entry");
    setNotice("Check your email for a 6-digit sign-in code.");
    setIsLoading(false);
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: "email",
    });

    if (error) {
      setError("That code is invalid or has expired. Request a new one below.");
      setIsLoading(false);
      return;
    }

    window.location.assign(nextPath);
  };

  const inputCls =
    "w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/20 focus:border-[#EE2A2E] transition-colors";
  const btnCls =
    "w-full py-2.5 bg-[#EE2A2E] text-white text-sm font-medium rounded-lg hover:bg-[#D92327] disabled:opacity-50 disabled:cursor-not-allowed transition-colors";

  return (
    <div>
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 p-3 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-800">
          {notice}
        </div>
      )}

      {mode === "password" && (
        <form onSubmit={handlePasswordLogin} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className={inputCls}
              placeholder="you@yourschool.ca"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className={inputCls}
              placeholder="Enter your password"
            />
          </div>
          <button type="submit" disabled={isLoading} className={btnCls}>
            {isLoading ? "Signing in..." : "Sign In"}
          </button>

          <div className="relative py-1">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-white px-2 text-xs text-gray-400">or</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setError(null);
              setMode("code_request");
            }}
            className="w-full py-2.5 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            Email me a sign-in code
          </button>
          <p className="text-center text-xs text-gray-500">
            No password needed — we&apos;ll send a 6-digit code.
          </p>

          <div className="text-center">
            <Link
              href={rawNext ? `/forgot-password?next=${encodeURIComponent(nextPath)}` : "/forgot-password"}
              className="text-sm text-gray-500 hover:text-[#EE2A2E] transition-colors"
            >
              Forgot your password?
            </Link>
          </div>
        </form>
      )}

      {mode === "code_request" && (
        <form onSubmit={handleRequestCode} className="space-y-4">
          <div>
            <label htmlFor="code-email" className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              id="code-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className={inputCls}
              placeholder="you@yourcompany.com"
            />
            <p className="mt-1 text-xs text-gray-500">
              We&apos;ll email you a 6-digit code. Nothing to click — just type it in.
            </p>
          </div>
          <button type="submit" disabled={isLoading} className={btnCls}>
            {isLoading ? "Sending..." : "Send me a code"}
          </button>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setNotice(null);
              setMode("password");
            }}
            className="w-full text-center text-sm text-gray-500 hover:text-[#EE2A2E]"
          >
            ← Use a password instead
          </button>
        </form>
      )}

      {mode === "code_entry" && (
        <form onSubmit={handleVerifyCode} className="space-y-4">
          <div>
            <label htmlFor="code" className="block text-sm font-medium text-gray-700 mb-1">
              6-digit code
            </label>
            <input
              id="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              required
              className={`${inputCls} text-center text-lg tracking-[0.4em] font-mono`}
              placeholder="000000"
            />
            <p className="mt-1 text-xs text-gray-500">Sent to {email}</p>
          </div>
          <button
            type="submit"
            disabled={isLoading || code.length !== 6}
            className={btnCls}
          >
            {isLoading ? "Verifying..." : "Sign in"}
          </button>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setNotice(null);
              setCode("");
              setMode("code_request");
            }}
            className="w-full text-center text-sm text-gray-500 hover:text-[#EE2A2E]"
          >
            Send a new code
          </button>
        </form>
      )}

      <div className="mt-6 pt-6 border-t border-gray-200 text-center">
        <p className="text-sm text-gray-600">
          New to CSC?{" "}
          <Link href="/membership" className="text-[#EE2A2E] hover:text-[#D92327] font-medium">
            Apply for membership
          </Link>
          {" "}or{" "}
          <Link href="/partnership" className="text-[#EE2A2E] hover:text-[#D92327] font-medium">
            partner with us
          </Link>
        </p>
      </div>
    </div>
  );
}
