"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { loginWithNext } from "@/lib/auth/login-redirect";
import { setDeskPin, verifyDeskPin } from "@/lib/actions/desk-pin";

/**
 * The check-in desk's PIN screens: choosing one, and asking for it.
 *
 * ⛔ The PIN guards two things only (lib/conference/desk-pin.ts): coming back
 * from hand-over, and approving an invoice. Forgotten, or five wrong tries:
 * sign out, sign in with the password, choose a new one.
 */

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"] as const;

/** Sign out and come back to this desk through the password sign-in. */
export async function signOutToDeskLogin(conferenceId: string) {
  await createClient().auth.signOut().catch(() => {});
  window.location.assign(loginWithNext(`/admin/conference/${conferenceId}/check-in`));
}

/** Big digits for fingers. Calls onSubmit with 4–6 digits. */
function PinPad({
  title,
  subtitle,
  error,
  busy,
  onSubmit,
  footer,
}: {
  title: string;
  subtitle?: string | null;
  error?: string | null;
  busy?: boolean;
  onSubmit: (pin: string) => void;
  footer?: React.ReactNode;
}) {
  const [digits, setDigits] = useState("");
  const press = (key: (typeof KEYS)[number]) => {
    if (busy) return;
    if (key === "clear") setDigits("");
    else if (key === "back") setDigits((d) => d.slice(0, -1));
    else setDigits((d) => (d.length < 6 ? d + key : d));
  };
  const submit = () => {
    if (digits.length < 4 || busy) return;
    onSubmit(digits);
    setDigits("");
  };
  return (
    <div className="fixed inset-0 z-[95] flex flex-col items-center justify-center gap-6 overflow-y-auto bg-gray-950 px-5 py-8 text-white">
      <div className="text-center">
        <p className="text-2xl font-bold">{title}</p>
        {subtitle ? <p className="mt-2 text-base text-gray-300">{subtitle}</p> : null}
      </div>
      <div className="flex h-6 items-center gap-3" aria-label={`${digits.length} digits entered`}>
        {Array.from({ length: Math.max(4, digits.length) }, (_, i) => (
          <span key={i} className={`h-4 w-4 rounded-full ${i < digits.length ? "bg-white" : "border-2 border-gray-500"}`} />
        ))}
      </div>
      {error ? <p className="rounded-lg bg-red-900/60 px-4 py-2 text-base text-red-100">{error}</p> : null}
      <div className="grid grid-cols-3 gap-3">
        {KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => press(key)}
            className="flex h-20 w-20 items-center justify-center rounded-full bg-gray-800 text-2xl font-semibold active:bg-gray-600"
          >
            {key === "clear" ? "Clear" : key === "back" ? "⌫" : key}
          </button>
        ))}
      </div>
      <button
        type="button"
        disabled={digits.length < 4 || busy}
        onClick={submit}
        className="min-h-14 w-full max-w-xs rounded-xl bg-white text-lg font-semibold text-gray-900 disabled:opacity-40"
      >
        {busy ? "Checking…" : "OK"}
      </button>
      {footer}
    </div>
  );
}

/**
 * Ask for the PIN. Five wrong tries signs the desk out — the PIN is gone and a
 * password sign-in is the only way back.
 */
export function DeskPinCheck({
  conferenceId,
  title,
  subtitle,
  onPassed,
  onCancel,
}: {
  conferenceId: string;
  title: string;
  subtitle?: string;
  onPassed: () => void;
  /** Absent for hand-over: there is no way out but the PIN. */
  onCancel?: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const check = async (pin: string) => {
    setBusy(true);
    setError(null);
    const res = await verifyDeskPin({ conferenceId, pin });
    if (!res.success) {
      setBusy(false);
      setError(res.error);
      return;
    }
    if (res.data.ok) {
      setBusy(false);
      onPassed();
      return;
    }
    if (res.data.lockedOut) {
      setError("Too many wrong tries. Signing out…");
      await signOutToDeskLogin(conferenceId);
      return;
    }
    setBusy(false);
    setError(`That is not the PIN. ${res.data.attemptsLeft} ${res.data.attemptsLeft === 1 ? "try" : "tries"} left.`);
  };
  return (
    <PinPad
      title={title}
      subtitle={subtitle}
      error={error}
      busy={busy}
      onSubmit={(pin) => void check(pin)}
      footer={
        <div className="flex flex-wrap justify-center gap-3">
          {onCancel ? (
            <button type="button" onClick={onCancel} className="min-h-12 rounded-lg border border-gray-600 px-5 text-base">
              Cancel
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void signOutToDeskLogin(conferenceId)}
            className="min-h-12 rounded-lg px-5 text-base text-gray-300 underline"
          >
            Forgot PIN? Sign in again
          </button>
        </div>
      }
    />
  );
}

/**
 * Choose a PIN: type it, then type it again. Without a fresh password sign-in
 * the server refuses (deskPinChangeAllowed), so this offers the sign-in.
 */
export function DeskPinSetup({
  conferenceId,
  mayChoose,
  onDone,
}: {
  conferenceId: string;
  mayChoose: boolean;
  onDone: () => void;
}) {
  const [first, setFirst] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!mayChoose) {
    return (
      <div className="fixed inset-0 z-[95] flex flex-col items-center justify-center gap-5 bg-gray-950 px-5 text-center text-white">
        <p className="text-2xl font-bold">Set your desk PIN</p>
        <p className="max-w-md text-base text-gray-300">
          The desk needs a PIN of your own. To choose one, sign in with your password again first.
        </p>
        <button
          type="button"
          onClick={() => void signOutToDeskLogin(conferenceId)}
          className="min-h-14 rounded-xl bg-white px-8 text-lg font-semibold text-gray-900"
        >
          Sign in again
        </button>
      </div>
    );
  }

  const enter = async (pin: string) => {
    if (first === null) {
      setFirst(pin);
      setError(null);
      return;
    }
    if (pin !== first) {
      setFirst(null);
      setError("Those did not match. Start again.");
      return;
    }
    setBusy(true);
    const res = await setDeskPin({ conferenceId, pin });
    setBusy(false);
    if (!res.success) {
      setFirst(null);
      setError(res.error);
      return;
    }
    onDone();
  };
  return (
    <PinPad
      key={first === null ? "first" : "again"}
      title={first === null ? "Choose your desk PIN" : "Type it again"}
      subtitle={
        first === null
          ? "4 to 6 digits. You will need it to approve an invoice and to take the device back after a customer pays on it."
          : null
      }
      error={error}
      busy={busy}
      onSubmit={(pin) => void enter(pin)}
    />
  );
}

/**
 * Hand-over: the customer pays on the desk's own iPad. Before the iPad goes to
 * Stripe the desk notes the sale here; when it comes back (success or cancel
 * both return to the desk) the desk stays locked until a PIN is entered.
 *
 * ⛔ Kept in this browser on purpose — it is about THIS iPad, not the person.
 * A reload or a new tab on the desk reads it again and stays locked.
 */
const handOverKey = (conferenceId: string) => `desk-handover:${conferenceId}`;

export function startHandOver(conferenceId: string, orderId: string) {
  try {
    window.localStorage.setItem(handOverKey(conferenceId), orderId);
  } catch {
    // Private mode: the desk will not lock on return. Nothing better to do.
  }
}

export function readHandOver(conferenceId: string): string | null {
  try {
    return window.localStorage.getItem(handOverKey(conferenceId));
  } catch {
    return null;
  }
}

export function endHandOver(conferenceId: string) {
  try {
    window.localStorage.removeItem(handOverKey(conferenceId));
  } catch {
    // nothing stored
  }
}
