"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function OneDriveSetupCard() {
  const router = useRouter();
  const [upn, setUpn]     = useState("");
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [result, setResult] = useState<{
    driveName?: string;
    driveId?:   string;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleDiscover() {
    const trimmed = upn.trim();
    if (!trimmed || !trimmed.includes("@")) {
      setErrorMsg("Enter a valid email address (the ED's Microsoft 365 login).");
      return;
    }
    setState("loading");
    setErrorMsg(null);
    setResult(null);

    try {
      const res  = await fetch("/api/admin/board/onedrive/discover", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ upn: trimmed, save: true }),
      });
      const data = await res.json() as {
        driveId?: string;
        driveName?: string;
        error?: string;
      };

      if (!res.ok || !data.driveId) {
        throw new Error(data.error ?? "Discovery failed");
      }

      setResult({ driveName: data.driveName, driveId: data.driveId });
      setState("success");
      // Refresh server data so the hub picks up the new drive ID
      router.refresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
      setState("error");
    }
  }

  if (state === "success" && result) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-5">
        <div className="flex items-start gap-3">
          <span className="text-2xl leading-none" aria-hidden>✓</span>
          <div>
            <h3 className="text-sm font-semibold text-green-800">OneDrive connected</h3>
            <p className="mt-1 text-sm text-green-700">
              Drive <strong>{result.driveName}</strong> configured.{" "}
              Use <strong>Sync OneDrive</strong> to pull the initial set of documents.
            </p>
            <p className="mt-1 text-xs text-green-600 font-mono break-all">{result.driveId}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
      <h3 className="text-sm font-semibold text-amber-900 mb-1">OneDrive not configured</h3>
      <p className="text-sm text-amber-800 mb-4">
        Enter the ED&apos;s Microsoft 365 email to discover their OneDrive for Business drive ID.
        This only needs to be done once.
      </p>

      <div className="flex gap-2">
        <input
          type="email"
          value={upn}
          onChange={(e) => setUpn(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleDiscover()}
          placeholder="ed@yourorg.ca"
          className="flex-1 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
          disabled={state === "loading"}
        />
        <button
          onClick={handleDiscover}
          disabled={state === "loading"}
          className="rounded-md border border-amber-400 bg-amber-100 px-4 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-200 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {state === "loading" ? "Discovering…" : "Connect Drive"}
        </button>
      </div>

      {errorMsg && (
        <p className="mt-2 text-xs text-red-600">{errorMsg}</p>
      )}

      <p className="mt-3 text-xs text-amber-700">
        The app needs <strong>Files.Read.All</strong> permission in Entra ID to read the ED&apos;s OneDrive.
      </p>
    </div>
  );
}
