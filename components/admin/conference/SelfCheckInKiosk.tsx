"use client";

/**
 * The desk's self check-in (kiosk) mode: what the attendee sees.
 *
 * ⛔ Not a second check-in screen. It is a layer over the desk's own camera,
 * and the desk does the scanning, agreements and printing exactly as it does
 * for staff (CheckInDeskClient, `self_service`). The layer covers every desk
 * control, so an attendee left alone with the iPad reaches nothing else; the
 * only way out is a staff PIN.
 */
export type KioskResult =
  | { kind: "in"; name: string | null; message: string; note: string | null }
  | { kind: "refused"; message: string };

export default function SelfCheckInKiosk({
  result,
  busy,
  onDone,
  onStaff,
}: {
  result: KioskResult | null;
  busy: boolean;
  onDone: () => void;
  onStaff: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[80] flex flex-col text-white">
      <div className="bg-black/80 px-6 py-6 text-center">
        <p className="text-3xl font-bold">Self check-in</p>
        <p className="mt-2 text-lg text-gray-200">
          Hold the QR code from your check-in email up to the camera.
        </p>
      </div>

      <div className="flex flex-1 items-center justify-center px-6">
        {busy ? (
          <div className="rounded-2xl bg-black/80 px-8 py-6 text-2xl font-semibold">Checking you in…</div>
        ) : result ? (
          <div
            className={`w-full max-w-xl rounded-2xl px-8 py-8 text-center shadow-2xl ${
              result.kind === "in" ? "bg-emerald-500 text-black" : "bg-white text-gray-900"
            }`}
          >
            {result.kind === "in" ? (
              <>
                <p className="text-3xl font-bold">
                  {result.name ? `Welcome, ${result.name}.` : "Welcome."} You are checked in.
                </p>
                <p className="mt-3 text-xl">{result.message}</p>
                {result.note ? <p className="mt-2 text-base">{result.note}</p> : null}
              </>
            ) : (
              <p className="text-2xl font-semibold">{result.message}</p>
            )}
            <button
              type="button"
              onClick={onDone}
              className="mt-6 min-h-14 w-full rounded-xl bg-black px-5 text-lg font-bold text-white"
            >
              Done
            </button>
          </div>
        ) : null}
      </div>

      <div className="flex justify-end bg-gradient-to-t from-black/70 to-transparent px-6 pb-6 pt-10">
        <button
          type="button"
          onClick={onStaff}
          className="rounded-full bg-white/15 px-4 py-2 text-sm font-semibold text-white/80"
        >
          Staff
        </button>
      </div>
    </div>
  );
}
