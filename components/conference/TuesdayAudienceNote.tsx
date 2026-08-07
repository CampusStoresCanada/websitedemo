const TUESDAY_CATEGORIES = [
  "accessories",
  "apparel",
  "campus living",
  "gifts & promotion",
  "graduation & regalia",
  "school & lab supplies",
  "technology",
];

/** Sets expectations for who Tuesday's curated meetings are built around, so a
 *  member whose buyer is outside general merchandise knows Wed/Thu is their day. */
export default function TuesdayAudienceNote() {
  return (
    <div className="rounded-2xl border border-[#E5E5E5] bg-[#FAFAFA] p-5">
      <p className="text-sm text-[#1A1A1A]/80">
        Tuesday&apos;s curated meetings are built primarily for general
        merchandise buyers — {TUESDAY_CATEGORIES.join(", ")}. Wednesday and
        Thursday are open to a broader audience, including course materials and
        operations.
      </p>
    </div>
  );
}
