"use client";

import { useEffect, useRef } from "react";

interface Props {
  campaignId: string;
  scheduledAt: string | null;
  action: (formData: FormData) => Promise<void>;
  buttonLabel: string;
}

/**
 * Schedule/reschedule form for a campaign send. The datetime-local input is
 * pre-filled and read in the browser's own local timezone — must be a
 * client component, since Date getters/parsing reflect the runtime's local
 * zone. Doing this server-side would show and store the server's timezone
 * (UTC on Vercel) instead of the admin's own, silently shifting every send
 * time by several hours.
 */
export default function RescheduleCampaignForm({
  campaignId,
  scheduledAt,
  action,
  buttonLabel,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const hiddenRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!inputRef.current || !scheduledAt) return;
    const d = new Date(scheduledAt);
    const pad = (n: number) => String(n).padStart(2, "0");
    inputRef.current.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }, [scheduledAt]);

  const handleSubmit = () => {
    if (inputRef.current && hiddenRef.current) {
      hiddenRef.current.value = inputRef.current.value
        ? new Date(inputRef.current.value).toISOString()
        : "";
    }
  };

  return (
    <form action={action} onSubmit={handleSubmit} className="flex items-center gap-1.5">
      <input type="hidden" name="campaign_id" value={campaignId} />
      <input
        ref={inputRef}
        type="datetime-local"
        className="rounded-lg border border-gray-300 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
      />
      <input ref={hiddenRef} type="hidden" name="scheduled_at" />
      <button
        type="submit"
        className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors whitespace-nowrap"
      >
        {buttonLabel}
      </button>
    </form>
  );
}
