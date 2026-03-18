"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Props = {
  conferenceId: string;
  initialState: Partial<WizardState> | null;
  initialStep: number | null;
  saveDraftAction: (formData: FormData) => Promise<void>;
  saveProgressAction: (formData: FormData) => Promise<void>;
};

type WizardState = {
  startFrom: "blank" | "current";
  canvasPreset: "oversized" | "trimmed";
  delegateOverlay: string;
  exhibitorOverlay: string;
  qrMode: "person_uuid" | "profile_link";
  frontTheme: "map_tint" | "solid_tint";
  reprintPipeline: "pdf" | "printer_bridge";
};

const DEFAULT_STATE: WizardState = {
  startFrom: "blank",
  canvasPreset: "oversized",
  delegateOverlay: "",
  exhibitorOverlay: "",
  qrMode: "person_uuid",
  frontTheme: "map_tint",
  reprintPipeline: "pdf",
};

export default function BadgeSetupWizardStub({
  conferenceId,
  initialState,
  initialStep,
  saveDraftAction,
  saveProgressAction,
}: Props) {
  const storageKey = useMemo(() => `badgeSetupDraft:${conferenceId}`, [conferenceId]);
  const [step, setStep] = useState<1 | 2 | 3>(() => {
    const value = Number(initialStep ?? 1);
    if (value === 2 || value === 3) return value;
    return 1;
  });
  const [state, setState] = useState<WizardState>(() => ({
    ...DEFAULT_STATE,
    ...(initialState ?? {}),
    startFrom: initialState?.startFrom === "current" ? "current" : "blank",
    canvasPreset: initialState?.canvasPreset === "trimmed" ? "trimmed" : "oversized",
    qrMode: initialState?.qrMode === "profile_link" ? "profile_link" : "person_uuid",
    frontTheme: initialState?.frontTheme === "solid_tint" ? "solid_tint" : "map_tint",
    reprintPipeline:
      initialState?.reprintPipeline === "printer_bridge" ? "printer_bridge" : "pdf",
  }));
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (initialState) {
      setLoaded(true);
      return;
    }
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) {
        setLoaded(true);
        return;
      }
      const parsed = JSON.parse(raw) as Partial<WizardState>;
      setState((prev) => ({
        ...prev,
        ...parsed,
        startFrom: parsed.startFrom === "current" ? "current" : "blank",
        canvasPreset: parsed.canvasPreset === "trimmed" ? "trimmed" : "oversized",
        qrMode: parsed.qrMode === "profile_link" ? "profile_link" : "person_uuid",
        frontTheme: parsed.frontTheme === "solid_tint" ? "solid_tint" : "map_tint",
        reprintPipeline: parsed.reprintPipeline === "printer_bridge" ? "printer_bridge" : "pdf",
      }));
    } catch {
      // no-op: if local draft is malformed we just use defaults
    } finally {
      setLoaded(true);
    }
  }, [initialState, storageKey]);

  useEffect(() => {
    if (!loaded) return;
    localStorage.setItem(storageKey, JSON.stringify(state));
  }, [loaded, state, storageKey]);

  function resetLocalDraft() {
    localStorage.removeItem(storageKey);
    setState(DEFAULT_STATE);
    setStep(1);
  }

  if (!loaded) {
    return (
      <section className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-600">
        Loading setup draft...
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-base font-semibold text-gray-900">Badge Setup Wizard (Stub)</h2>
      <p className="mt-1 text-sm text-gray-600">
        Draft-first setup flow. Progress auto-saves in this browser so you can leave and return.
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <button
          type="button"
          onClick={() => setStep(1)}
          className={`rounded-md border px-3 py-2 text-sm font-medium ${
            step === 1
              ? "border-[#EE2A2E] bg-red-50 text-[#EE2A2E]"
              : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
          }`}
        >
          1. Canvas & Assets
        </button>
        <button
          type="button"
          onClick={() => setStep(2)}
          className={`rounded-md border px-3 py-2 text-sm font-medium ${
            step === 2
              ? "border-[#EE2A2E] bg-red-50 text-[#EE2A2E]"
              : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
          }`}
        >
          2. Behavior
        </button>
        <button
          type="button"
          onClick={() => setStep(3)}
          className={`rounded-md border px-3 py-2 text-sm font-medium ${
            step === 3
              ? "border-[#EE2A2E] bg-red-50 text-[#EE2A2E]"
              : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
          }`}
        >
          3. Review & Save
        </button>
      </div>

      {step === 1 ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="text-sm text-gray-700">
            Starting point
            <select
              value={state.startFrom}
              onChange={(event) =>
                setState((prev) => ({
                  ...prev,
                  startFrom: event.target.value === "current" ? "current" : "blank",
                }))
              }
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
            >
              <option value="blank">Blank slate (recommended)</option>
              <option value="current">Use current template as base</option>
            </select>
          </label>

          <label className="text-sm text-gray-700">
            Canvas preset
            <select
              value={state.canvasPreset}
              onChange={(event) =>
                setState((prev) => ({
                  ...prev,
                  canvasPreset: event.target.value === "trimmed" ? "trimmed" : "oversized",
                }))
              }
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
            >
              <option value="oversized">Oversized (3.25&quot; x 5.25&quot; + 0.125&quot; bleed)</option>
              <option value="trimmed">Trimmed (3&quot; x 5&quot;)</option>
            </select>
          </label>

          <label className="text-sm text-gray-700">
            Delegate overlay URL
            <input
              value={state.delegateOverlay}
              onChange={(event) =>
                setState((prev) => ({ ...prev, delegateOverlay: event.target.value }))
              }
              placeholder="/badges/delegate-front-overlay-v1.png"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
            />
          </label>

          <label className="text-sm text-gray-700">
            Exhibitor overlay URL
            <input
              value={state.exhibitorOverlay}
              onChange={(event) =>
                setState((prev) => ({ ...prev, exhibitorOverlay: event.target.value }))
              }
              placeholder="/badges/exhibitor-front-overlay-v1.png"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
            />
          </label>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="text-sm text-gray-700">
            QR mode
            <select
              value={state.qrMode}
              onChange={(event) =>
                setState((prev) => ({
                  ...prev,
                  qrMode: event.target.value === "profile_link" ? "profile_link" : "person_uuid",
                }))
              }
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
            >
              <option value="person_uuid">Immutable person UUID</option>
              <option value="profile_link">Profile link payload (future)</option>
            </select>
          </label>

          <label className="text-sm text-gray-700">
            Front visual base
            <select
              value={state.frontTheme}
              onChange={(event) =>
                setState((prev) => ({
                  ...prev,
                  frontTheme: event.target.value === "solid_tint" ? "solid_tint" : "map_tint",
                }))
              }
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
            >
              <option value="map_tint">Map tint background</option>
              <option value="solid_tint">Solid tint background</option>
            </select>
          </label>

          <label className="text-sm text-gray-700">
            Reprint pipeline default
            <select
              value={state.reprintPipeline}
              onChange={(event) =>
                setState((prev) => ({
                  ...prev,
                  reprintPipeline:
                    event.target.value === "printer_bridge" ? "printer_bridge" : "pdf",
                }))
              }
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
            >
              <option value="pdf">PDF (manual print)</option>
              <option value="printer_bridge">Printer bridge (future)</option>
            </select>
          </label>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
          <p className="font-medium text-gray-900">Draft summary</p>
          <ul className="mt-2 list-disc pl-5">
            <li>Canvas: {state.canvasPreset === "oversized" ? "Oversized" : "Trimmed"}</li>
            <li>QR mode: {state.qrMode}</li>
            <li>Front theme: {state.frontTheme}</li>
            <li>Reprint default: {state.reprintPipeline}</li>
          </ul>
          <p className="mt-2 text-xs text-gray-500">
            Saving creates a new draft template version and keeps this wizard draft for future edits.
          </p>
        </div>
      ) : null}

      <form action={saveProgressAction} className="mt-4 flex flex-wrap gap-2">
        <input type="hidden" name="start_from" value={state.startFrom} />
        <input type="hidden" name="canvas_preset" value={state.canvasPreset} />
        <input type="hidden" name="delegate_overlay" value={state.delegateOverlay} />
        <input type="hidden" name="exhibitor_overlay" value={state.exhibitorOverlay} />
        <input type="hidden" name="qr_mode" value={state.qrMode} />
        <input type="hidden" name="front_theme" value={state.frontTheme} />
        <input type="hidden" name="reprint_pipeline" value={state.reprintPipeline} />
        <input type="hidden" name="setup_last_step" value={String(step)} />
        <button
          type="submit"
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Save Progress
        </button>
      </form>

      <form action={saveDraftAction} className="mt-2 flex flex-wrap gap-2">
        <input type="hidden" name="start_from" value={state.startFrom} />
        <input type="hidden" name="canvas_preset" value={state.canvasPreset} />
        <input type="hidden" name="delegate_overlay" value={state.delegateOverlay} />
        <input type="hidden" name="exhibitor_overlay" value={state.exhibitorOverlay} />
        <input type="hidden" name="qr_mode" value={state.qrMode} />
        <input type="hidden" name="front_theme" value={state.frontTheme} />
        <input type="hidden" name="reprint_pipeline" value={state.reprintPipeline} />
        <input type="hidden" name="setup_last_step" value={String(step)} />

        <button
          type="submit"
          className="rounded-md bg-[#EE2A2E] px-4 py-2 text-sm font-medium text-white hover:bg-[#b50001]"
        >
          Save Setup Draft
        </button>

        <Link
          href={`/admin/conference/${conferenceId}/badges?mode=studio`}
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Continue in Working Studio
        </Link>

        <button
          type="button"
          onClick={resetLocalDraft}
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Reset Local Draft
        </button>

        <Link
          href={`/admin/conference/${conferenceId}`}
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Exit for Now
        </Link>
      </form>
    </section>
  );
}
