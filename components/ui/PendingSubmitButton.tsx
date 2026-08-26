"use client";

import { useFormStatus } from "react-dom";

/**
 * Submit button that disables itself and changes label while its form's server
 * action is in flight.
 *
 * Server-component forms give no feedback of their own: unless the action calls
 * revalidatePath, the page comes back identical and a real mutation looks like a
 * dead button. That is what drove a comms campaign out three times on 2026-08-26.
 * revalidatePath is the fix where the action changes rendered state; this button
 * covers the in-flight gap, and is the only feedback available for actions (like
 * resending an email) that change nothing on the page at all.
 */
export default function PendingSubmitButton({
  label,
  pendingLabel,
  className,
  variant = "primary",
}: {
  label: string;
  pendingLabel: string;
  /** Overrides the built-in variant styling when a surface has its own button look. */
  className?: string;
  variant?: "primary" | "secondary";
}) {
  const { pending } = useFormStatus();

  const styles =
    className ??
    (variant === "primary"
      ? "rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
      : "rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50");

  return (
    <button
      type="submit"
      disabled={pending}
      className={`${styles} transition-colors disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
