/**
 * What a vendor sees after scanning an attendee's badge.
 *
 * ⛔ No button, and not a client component. The scan IS the capture — pointing
 * a camera at a badge is already the decision, and a confirm tap only lost
 * captures from people who walked away. This just reports what happened, and
 * what has NOT happened: the attendee's details have not moved.
 */
export function ScanCaptured({
  personName,
  disclosureStatus,
}: {
  personName: string;
  disclosureStatus: string | null;
}) {
  const body =
    disclosureStatus === "released"
      ? `${personName} has shared their details with you.`
      : disclosureStatus === "declined"
        ? `${personName} chose not to share their details.`
        : `${personName} has been asked whether to share their contact details. Nothing has been sent to you yet.`;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <p className="font-medium text-slate-900">
        {disclosureStatus === "released"
          ? "Shared with you"
          : disclosureStatus === "declined"
            ? "Not shared"
            : "Captured — waiting on them"}
      </p>
      <p className="mt-1 text-sm text-slate-600">{body}</p>
    </div>
  );
}
