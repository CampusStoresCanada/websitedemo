"use client";

import { useFormStatus } from "react-dom";

/**
 * Submit button that disables itself while its form's server action is in
 * flight. The real duplicate-send protection is the status claim inside
 * executeCampaignSend — this only closes the window where an operator, seeing
 * no feedback, clicks again before the first send finishes.
 */
export default function SendCampaignButton({
  label,
  pendingLabel,
  variant = "primary",
}: {
  label: string;
  pendingLabel: string;
  variant?: "primary" | "secondary";
}) {
  const { pending } = useFormStatus();

  const base =
    "rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60";
  const styles =
    variant === "primary"
      ? "bg-accent text-white hover:bg-accent-hover"
      : "border border-gray-300 text-gray-600 hover:bg-gray-50";

  return (
    <button type="submit" disabled={pending} className={`${base} ${styles}`}>
      {pending ? pendingLabel : label}
    </button>
  );
}
