"use client";

import { useState, useTransition } from "react";
import { saveSelfCheckInSettings } from "@/lib/actions/self-check-in-settings";
import type { SelfCheckInEnding, SelfCheckInSettings } from "@/lib/conference/self-check-in";

const ENDING_LABELS: Record<SelfCheckInEnding, string> = {
  desk: "Pick up their badge at the registration desk",
  bins: "Pick up their badge from a bin, by last name",
  spare_stickers: "Take a blank card; the print station prints their stickers (kiosk only)",
};

/**
 * Self check-in for this conference: whether attendees can check themselves
 * in, where, and what they are told to do next.
 *
 * ⛔ Off until someone turns it on here. Every conference runs pickup its own
 * way, so nothing about it is assumed.
 */
export default function SelfCheckInEditor({
  conferenceId,
  initial,
}: {
  conferenceId: string;
  initial: SelfCheckInSettings;
}) {
  const [settings, setSettings] = useState<SelfCheckInSettings>(initial);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const change = (patch: Partial<SelfCheckInSettings>) => {
    setSaved(false);
    setSettings((prev) => ({ ...prev, ...patch }));
  };
  const save = () =>
    startTransition(async () => {
      setError(null);
      const res = await saveSelfCheckInSettings(conferenceId, settings);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSettings(res.data);
      setSaved(true);
    });

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-600">
        Attendees check themselves in with the QR code in their check-in email. They accept any
        agreements they still owe, and the day rules apply exactly as at the desk. Put the email
        fields <code>{"{{check_in_qr_url}}"}</code> (an image) and <code>{"{{check_in_link}}"}</code>{" "}
        in a conference email to send each person their code. They stay empty while both are off.
      </p>

      <label className="flex items-start gap-2 text-sm text-gray-900">
        <input
          type="checkbox"
          className="mt-1"
          checked={settings.kiosk}
          onChange={(event) => change({ kiosk: event.target.checked })}
        />
        <span>
          Kiosk
          <span className="block text-xs text-gray-600">
            Desk staff can switch a desk device into self check-in from the desk tools. Only a
            staff PIN switches it back.
          </span>
        </span>
      </label>

      <label className="flex items-start gap-2 text-sm text-gray-900">
        <input
          type="checkbox"
          className="mt-1"
          checked={settings.phone}
          onChange={(event) => change({ phone: event.target.checked })}
        />
        <span>
          Their own phone
          <span className="block text-xs text-gray-600">
            The link in the email checks them in, on conference days only. Opening the link does
            nothing until they press Check me in.
          </span>
        </span>
      </label>

      <label className="block text-xs text-gray-700">
        Once they are checked in
        <select
          value={settings.ending}
          onChange={(event) => change({ ending: event.target.value as SelfCheckInEnding })}
          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
        >
          {(Object.keys(ENDING_LABELS) as SelfCheckInEnding[]).map((ending) => (
            <option key={ending} value={ending}>
              {ENDING_LABELS[ending]}
            </option>
          ))}
        </select>
      </label>

      {settings.ending === "bins" ? (
        <div className="space-y-2">
          <p className="text-xs text-gray-700">
            Bins, by the first letter of the last name. Anyone no bin holds is sent to the desk.
          </p>
          {settings.bins.map((bin, index) => (
            <div key={index} className="flex flex-wrap items-center gap-2">
              <input
                value={bin.from}
                maxLength={1}
                aria-label="From letter"
                onChange={(event) =>
                  change({
                    bins: settings.bins.map((b, i) =>
                      i === index ? { ...b, from: event.target.value.toUpperCase() } : b
                    ),
                  })
                }
                className="w-12 rounded border border-gray-300 px-2 py-1 text-center text-sm"
              />
              <span className="text-xs text-gray-500">to</span>
              <input
                value={bin.to}
                maxLength={1}
                aria-label="To letter"
                onChange={(event) =>
                  change({
                    bins: settings.bins.map((b, i) =>
                      i === index ? { ...b, to: event.target.value.toUpperCase() } : b
                    ),
                  })
                }
                className="w-12 rounded border border-gray-300 px-2 py-1 text-center text-sm"
              />
              <input
                value={bin.label}
                placeholder="Sign on the bin"
                aria-label="Sign on the bin"
                onChange={(event) =>
                  change({
                    bins: settings.bins.map((b, i) => (i === index ? { ...b, label: event.target.value } : b)),
                  })
                }
                className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
              />
              <button
                type="button"
                onClick={() => change({ bins: settings.bins.filter((_, i) => i !== index) })}
                className="text-xs text-red-600 underline"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => change({ bins: [...settings.bins, { label: "", from: "", to: "" }] })}
            className="text-xs font-medium text-gray-900 underline"
          >
            Add a bin
          </button>
        </div>
      ) : null}

      <label className="block text-xs text-gray-700">
        A line shown after check-in (optional)
        <input
          value={settings.note ?? ""}
          maxLength={300}
          placeholder="Lanyards are on the table to your left."
          onChange={(event) => change({ note: event.target.value })}
          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
        />
      </label>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded bg-gray-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save self check-in"}
        </button>
        {saved ? <span className="text-xs text-green-700">Saved.</span> : null}
        {error ? <span className="text-xs text-red-600">{error}</span> : null}
      </div>
    </div>
  );
}
