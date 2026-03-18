import type { DaySaturation } from "@/lib/calendar/types";

type Props = {
  saturation: DaySaturation[];
};

export default function CalendarSaturationBar({ saturation }: Props) {
  const overloaded = saturation.filter((d) => d.overloaded);
  if (overloaded.length === 0) return null;

  return (
    <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
      <span className="font-semibold">Load saturation warning:</span>{" "}
      {overloaded.length} day{overloaded.length > 1 ? "s" : ""} have 5 or more operational items —{" "}
      <span className="font-medium">
        {overloaded
          .slice(0, 4)
          .map((d) =>
            new Date(d.date + "T12:00:00Z").toLocaleDateString("en-CA", {
              month: "short",
              day:   "numeric",
              timeZone: "America/Toronto",
            })
          )
          .join(", ")}
        {overloaded.length > 4 ? ` +${overloaded.length - 4} more` : ""}
      </span>
      . Review scheduling to avoid overlap.
    </div>
  );
}
