import { CONFERENCE_STATUS_LABELS, type ConferenceStatus } from "@/lib/constants/conference";

export default function DraftPreviewBanner({ status }: { status: string }) {
  const label = CONFERENCE_STATUS_LABELS[status as ConferenceStatus] ?? status;

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      <strong>Draft preview</strong> — this conference is currently <strong>{label}</strong> and
      not visible to the public.
    </div>
  );
}
