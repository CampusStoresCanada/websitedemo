"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/AuthProvider";
import { createClient } from "@/lib/supabase/client";
import type { PermissionState } from "@/lib/auth/types";

const PERMISSION_OPTIONS: { value: PermissionState | "real"; label: string }[] =
  [
    { value: "real", label: "Use Real Auth" },
    { value: "public", label: "Public (Logged Out)" },
    { value: "partner", label: "Partner" },
    { value: "member", label: "Member" },
    { value: "org_admin", label: "Org Admin" },
    { value: "admin", label: "Admin" },
    { value: "super_admin", label: "Super Admin" },
  ];

const TEST_ACCOUNTS = [
  { email: "google@campusstores.ca", password: "Mkpspxw8BA!vb3T", label: "Super Admin (Steve)" },
  { email: "daviess@algonquincollege.com", password: "CSCBoard2026!", label: "Admin (Shawn)" },
  { email: "adam.hustwitt@nscc.ca", password: "CSCMember2026!", label: "Org Admin — Member" },
  { email: "adam.raisin@cesiumtelecom.com", password: "CSCMember2026!", label: "Org Admin — Partner" },
  { email: "acain01@uoguelph.ca", password: "CSCUser2026!", label: "Member User" },
];

export default function DevPanel() {
  const [show, setShow] = useState(false);
  const [loginLoading, setLoginLoading] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const router = useRouter();
  const {
    user,
    profile,
    permissionState,
    organizations,
    isSurveyParticipant,
    devOverride,
    setDevOverride,
    devSurveyParticipantOverride,
    setDevSurveyParticipantOverride,
    signOut,
  } = useAuth();
  const supabase = createClient();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "D") {
        e.preventDefault();
        setShow((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const quickLogin = async (email: string, password: string) => {
    setLoginLoading(email);
    setLoginError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setLoginError(`${email}: ${error.message}`);
    }
    setLoginLoading(null);
    // onAuthStateChange in AuthProvider handles the rest
    router.refresh();
  };

  if (!show) {
    // Show a small indicator when dev override is active
    if (devOverride) {
      return (
        <button
          onClick={() => setShow(true)}
          className="fixed bottom-4 right-4 z-[200] px-3 py-1.5 bg-purple-600 text-white text-[10px] font-mono rounded-full shadow-lg opacity-80 hover:opacity-100 transition-opacity"
        >
          DEV: {devOverride}
        </button>
      );
    }
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-[200] w-72 bg-white/95 backdrop-blur-sm border border-gray-200 rounded-xl shadow-2xl overflow-hidden font-mono text-xs">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-900 text-white">
        <span className="font-semibold tracking-wider">DEV PANEL</span>
        <button
          onClick={() => setShow(false)}
          className="text-gray-400 hover:text-white transition-colors"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18 18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Current Auth State */}
        <div>
          <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1">
            Current State
          </p>
          {user ? (
            <div className="space-y-1">
              <p className="text-gray-900 truncate">{user.email}</p>
              <p className="text-gray-500">
                Role: {profile?.global_role || "user"}
              </p>
              <p className="text-gray-500">
                Permission: <span className="text-purple-600 font-semibold">{permissionState}</span>
                {devOverride && <span className="text-amber-500"> (override)</span>}
              </p>
              <p className="text-gray-500">
                Survey: <span className={isSurveyParticipant ? "text-green-600" : "text-gray-400"}>{isSurveyParticipant ? "Yes" : "No"}</span>
                {devSurveyParticipantOverride !== null && <span className="text-amber-500"> (override)</span>}
              </p>
              {organizations.length > 0 && (
                <p className="text-gray-500">
                  Orgs: {organizations.map((o) => o.organization.name).join(", ")}
                </p>
              )}
            </div>
          ) : (
            <p className="text-gray-500">Not logged in</p>
          )}
        </div>

        {/* Permission Override */}
        <div>
          <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1">
            Override Permission
          </p>
          <select
            value={devOverride || "real"}
            onChange={(e) => {
              const val = e.target.value;
              setDevOverride(
                val === "real" ? null : (val as PermissionState)
              );
            }}
            className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs bg-white focus:outline-none focus:ring-1 focus:ring-purple-500"
          >
            {PERMISSION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Survey Participant Override */}
        <div>
          <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1">
            Survey Participant
          </p>
          <div className="flex gap-1">
            <button
              onClick={() => setDevSurveyParticipantOverride(null)}
              className={`flex-1 px-2 py-1.5 rounded text-[10px] font-medium transition-colors ${
                devSurveyParticipantOverride === null
                  ? "bg-gray-900 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              Real
            </button>
            <button
              onClick={() => setDevSurveyParticipantOverride(true)}
              className={`flex-1 px-2 py-1.5 rounded text-[10px] font-medium transition-colors ${
                devSurveyParticipantOverride === true
                  ? "bg-green-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              Yes
            </button>
            <button
              onClick={() => setDevSurveyParticipantOverride(false)}
              className={`flex-1 px-2 py-1.5 rounded text-[10px] font-medium transition-colors ${
                devSurveyParticipantOverride === false
                  ? "bg-red-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              No
            </button>
          </div>
        </div>

        {/* Quick Login */}
        <div>
          <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1">
            Quick Login
          </p>
          {loginError && (
            <div className="mb-2 p-2 bg-red-50 border border-red-200 rounded text-[10px] text-red-600">
              {loginError}
            </div>
          )}
          <div className="space-y-1">
            {TEST_ACCOUNTS.map((account) => (
              <button
                key={account.email}
                onClick={() => quickLogin(account.email, account.password)}
                disabled={loginLoading === account.email}
                className="w-full text-left px-2 py-1.5 rounded hover:bg-gray-100 transition-colors disabled:opacity-50 flex items-center justify-between"
              >
                <span className="text-gray-700">{account.label}</span>
                <span className="text-gray-400 text-[9px]">
                  {loginLoading === account.email ? "..." : account.email}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Sign Out */}
        {user && (
          <button
            onClick={signOut}
            className="w-full py-1.5 text-center text-red-600 hover:bg-red-50 rounded transition-colors"
          >
            Sign Out
          </button>
        )}
      </div>

      <div className="px-4 py-2 bg-gray-50 border-t border-gray-200 text-[9px] text-gray-400">
        Ctrl+Shift+D to toggle
      </div>
    </div>
  );
}
