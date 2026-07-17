"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ensureConferenceDays,
  updateConferenceDay,
  deleteConferenceDay,
  type ConferenceCatalog,
  type ConferenceDayProfile,
} from "@/lib/actions/conference-catalog";

interface DescribeManagerProps {
  conferenceId: string;
  startDate: string | null;
  endDate: string | null;
  catalog: ConferenceCatalog;
}

const DAY_PROFILES: ConferenceDayProfile[] = ["full_day", "half_day", "travel", "other"];

type RunFn = (fn: () => Promise<{ success: boolean; error?: string }>) => Promise<boolean>;

export default function DescribeManager({
  conferenceId,
  startDate,
  endDate,
  catalog,
}: DescribeManagerProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<{ success: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    const result = await fn();
    setBusy(false);
    if (!result.success) {
      setError(result.error ?? "Something went wrong.");
      return false;
    }
    router.refresh();
    return true;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Days</h1>
        <p className="mt-1 text-sm text-gray-500">
          Define the conference days. Everything sold is built in the Catalog (Build) tab; meeting
          suites and per-day meeting cadence are defined there too.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {/* DAYS ----------------------------------------------------------------- */}
      <Section
        title="Days"
        subtitle={
          startDate && endDate
            ? `${startDate} – ${endDate}`
            : "Set conference start/end dates in Edit first."
        }
        action={
          <button
            type="button"
            disabled={busy || !startDate || !endDate}
            onClick={() => run(() => ensureConferenceDays(conferenceId))}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Sync days to dates
          </button>
        }
      >
        {catalog.days.length === 0 ? (
          <Empty>No days yet. Set dates in Edit, then “Sync days to dates”.</Empty>
        ) : (
          <ul className="divide-y divide-gray-100">
            {catalog.days.map((day) => (
              <DayRow key={day.id} day={day} busy={busy} run={run} />
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Shared layout primitives
// ─────────────────────────────────────────────────────────────────

function Section({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          <p className="text-xs text-gray-500">{subtitle}</p>
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-gray-500">{children}</p>;
}

const inputClass =
  "rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-accent";

function DayRow({
  day,
  busy,
  run,
}: {
  day: ConferenceCatalog["days"][number];
  busy: boolean;
  run: RunFn;
}) {
  const [profile, setProfile] = useState<ConferenceDayProfile>(day.day_profile as ConferenceDayProfile);
  const [label, setLabel] = useState(day.label ?? "");
  const dirty = profile !== day.day_profile || label !== (day.label ?? "");
  return (
    <li className="flex flex-wrap items-center gap-3 py-2">
      <span className="w-28 shrink-0 text-sm font-medium text-gray-900">{day.date}</span>
      <select
        value={profile}
        onChange={(e) => setProfile(e.target.value as ConferenceDayProfile)}
        className={inputClass}
      >
        {DAY_PROFILES.map((p) => (
          <option key={p} value={p}>
            {p.replace("_", " ")}
          </option>
        ))}
      </select>
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="label (optional)"
        className={`${inputClass} flex-1 min-w-32`}
      />
      <button
        type="button"
        disabled={busy || !dirty}
        onClick={() => run(() => updateConferenceDay(day.id, { dayProfile: profile, label: label || null }))}
        className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40"
      >
        Save
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => run(() => deleteConferenceDay(day.id))}
        className="text-xs text-red-600 hover:underline disabled:opacity-40"
      >
        Delete
      </button>
    </li>
  );
}
