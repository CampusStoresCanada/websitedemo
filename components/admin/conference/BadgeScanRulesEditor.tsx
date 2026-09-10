"use client";

import { useMemo, useState, useTransition } from "react";
import { saveBadgeScanRules, type BadgeScanRuleOptions } from "@/lib/actions/badge-scan-rules";
import {
  SCAN_DIRECTIONS,
  SCAN_DESTINATIONS,
  type BadgeScanRules,
  type ScanDestination,
  type ScanDirection,
} from "@/lib/conference/badges/rules";

const DIRECTION_LABELS: Record<ScanDirection, string> = {
  self: "Someone scans their own badge",
  attendeeToCompany: "An attendee scans a company's badge",
  attendeeToAttendee: "An attendee scans another attendee",
  companyToCompany: "A company scans another company",
  companyToAttendee: "A company scans an attendee",
};

const DESTINATION_LABELS: Record<ScanDestination, string> = {
  org: "The organisation's page",
  circle: "Their community profile",
  capture: "Capture as a lead — asks them first",
  map: "The conference map",
  none: "Nothing",
};

/**
 * Who captures leads, and which days print.
 *
 * ⛔ Every option is ENUMERATED from live data — the organisation types that
 * actually exist, the days this conference actually has. Nothing is typed in.
 * A misspelled organisation type would silently stop the consent gate firing,
 * and a day id typed from memory would silently drop a day off every badge.
 *
 * ⛔ Anything UNASSIGNED is shown, not hidden, with what will happen to it. The
 * whole failure this replaces was a rule nobody could see: an organisation type
 * nobody had classified, governed by a default nobody knew was running.
 */
export function BadgeScanRulesEditor({
  conferenceId,
  options,
}: {
  conferenceId: string;
  options: BadgeScanRuleOptions;
}) {
  const [rules, setRules] = useState<BadgeScanRules>(options.rules);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unclassified = useMemo(
    () =>
      options.orgTypes.filter(
        (type) =>
          !rules.disclosingOrgTypes.includes(type) && !rules.attendeeOrgTypes.includes(type)
      ),
    [options.orgTypes, rules.disclosingOrgTypes, rules.attendeeOrgTypes]
  );

  function assign(type: string, side: "captures" | "attendee" | "none") {
    setSaved(false);
    setRules((prev) => ({
      ...prev,
      disclosingOrgTypes:
        side === "captures"
          ? [...new Set([...prev.disclosingOrgTypes, type])]
          : prev.disclosingOrgTypes.filter((t) => t !== type),
      attendeeOrgTypes:
        side === "attendee"
          ? [...new Set([...prev.attendeeOrgTypes, type])]
          : prev.attendeeOrgTypes.filter((t) => t !== type),
    }));
  }

  function sideOf(type: string): "captures" | "attendee" | "none" {
    if (rules.disclosingOrgTypes.includes(type)) return "captures";
    if (rules.attendeeOrgTypes.includes(type)) return "attendee";
    return "none";
  }

  function toggleDay(dayId: string) {
    setSaved(false);
    setRules((prev) => ({
      ...prev,
      onsiteDayIds: prev.onsiteDayIds.includes(dayId)
        ? prev.onsiteDayIds.filter((id) => id !== dayId)
        : [...prev.onsiteDayIds, dayId],
    }));
  }

  function save() {
    startTransition(async () => {
      setError(null);
      const result = await saveBadgeScanRules(conferenceId, rules);
      if (result.ok) setSaved(true);
      else setError(result.error);
    });
  }

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-semibold text-gray-900">Who captures leads</h3>
        <p className="mt-1 text-xs text-gray-600">
          Scanning an attendee&apos;s badge from a lead-capture organisation sends that
          attendee&apos;s contact details off-platform, so we ask them first. Everything
          else stays internal.
        </p>
        <div className="mt-3 space-y-1">
          {options.orgTypes.map((type) => (
            <div
              key={type}
              className="flex flex-wrap items-center justify-between gap-2 rounded border border-gray-200 px-3 py-2"
            >
              <span className="text-sm text-gray-900">{type}</span>
              <div className="flex gap-1">
                {(
                  [
                    ["captures", "Captures leads"],
                    ["attendee", "Is an attendee"],
                    ["none", "Unassigned"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => assign(type, value)}
                    className={`rounded border px-2 py-1 text-[11px] ${
                      sideOf(type) === value
                        ? "border-accent bg-accent/10 font-semibold"
                        : "border-gray-300 text-gray-600"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-semibold text-gray-900">
            {unclassified.length === 0
              ? "Every organisation type is assigned."
              : `Unassigned: ${unclassified.join(", ")}`}
          </p>
          <label className="mt-2 flex items-start gap-2 text-xs text-gray-700">
            <input
              type="checkbox"
              checked={rules.unlistedOrgTypeDiscloses}
              onChange={(event) => {
                setSaved(false);
                setRules((prev) => ({
                  ...prev,
                  unlistedOrgTypeDiscloses: event.target.checked,
                }));
              }}
              className="mt-0.5"
            />
            <span>
              Ask the attendee before sharing anything when an unassigned organisation
              type scans them.{" "}
              <strong>
                {rules.unlistedOrgTypeDiscloses
                  ? "On — they will be asked."
                  : "Off — the scan is treated as internal and nobody is asked."}
              </strong>{" "}
              This also covers organisation types added after today.
            </span>
          </label>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-gray-900">Where each scan goes</h3>
        <p className="mt-1 text-xs text-gray-600">
          Who is standing there is worked out from the assignments above. Where that
          sends them is your decision — a conference with no community can send
          attendee-to-attendee scans to the organisation&apos;s page instead.
        </p>
        <div className="mt-3 space-y-1">
          {SCAN_DIRECTIONS.map((direction) => (
            <label
              key={direction}
              className="flex flex-wrap items-center justify-between gap-2 rounded border border-gray-200 px-3 py-2 text-sm"
            >
              <span className="text-gray-900">{DIRECTION_LABELS[direction]}</span>
              <select
                value={rules.destinations[direction]}
                onChange={(event) => {
                  setSaved(false);
                  setRules((prev) => ({
                    ...prev,
                    destinations: {
                      ...prev.destinations,
                      [direction]: event.target.value as ScanDestination,
                    },
                  }));
                }}
                className="rounded border border-gray-300 px-2 py-1 text-xs"
              >
                {SCAN_DESTINATIONS.map((destination) => (
                  <option key={destination} value={destination}>
                    {DESTINATION_LABELS[destination]}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        {rules.destinations.companyToAttendee !== "capture" ? (
          <p className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-gray-700">
            Lead capture is off. A company scanning an attendee will not queue a request,
            so nobody is asked and no details are ever shared — the attendee list is all
            an exhibitor gets.
          </p>
        ) : null}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-gray-900">Which days print</h3>
        <p className="mt-1 text-xs text-gray-600">
          The badge is collected on site, so pre- and post-conference days are normally
          left off. Tick the days you want printed, or leave them all unticked and let it
          work itself out.
        </p>
        <div className="mt-3 space-y-1">
          {options.days.length === 0 ? (
            <p className="text-xs text-gray-500">This conference has no days yet.</p>
          ) : null}
          {options.days.map((day) => (
            <label
              key={day.id}
              className="flex items-center gap-2 rounded border border-gray-200 px-3 py-2 text-sm"
            >
              <input
                type="checkbox"
                checked={rules.onsiteDayIds.includes(day.id)}
                onChange={() => toggleDay(day.id)}
              />
              <span className="text-gray-900">{day.name}</span>
              {day.date ? <span className="text-xs text-gray-500">{day.date}</span> : null}
            </label>
          ))}
        </div>
        <label className="mt-3 block text-xs text-gray-700">
          Days not ticked above
          <select
            value={rules.unlistedDayMode}
            onChange={(event) => {
              setSaved(false);
              setRules((prev) => ({
                ...prev,
                unlistedDayMode: event.target.value as BadgeScanRules["unlistedDayMode"],
              }));
            }}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
          >
            <option value="derive">Work it out — the main run of consecutive days</option>
            <option value="include">Print every day</option>
            <option value="exclude">Print only the days ticked above</option>
          </select>
        </label>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded bg-gray-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save rules"}
        </button>
        {saved ? <span className="text-xs text-green-700">Saved.</span> : null}
        {error ? <span className="text-xs text-red-600">{error}</span> : null}
      </div>
    </div>
  );
}

export default BadgeScanRulesEditor;
