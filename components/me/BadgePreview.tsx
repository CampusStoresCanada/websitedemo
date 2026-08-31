import { renderBadgeHtml } from "@/lib/conference/badges/render-html";
import type { BadgeTemplateConfigV1, BadgeRole } from "@/lib/conference/badges/template";

/**
 * What their badge will actually say — rendered by the badge system itself.
 *
 * ⛔ The first version of this drew a badge I invented: a centred white card
 * with three lines of my choosing. That is the worst possible place to
 * fabricate, because the whole purpose is "confirm this is correct" — a
 * preview that does not match the print run gets someone to sign off on a
 * layout that is not theirs. The real renderer splits first and last name into
 * separate slots and uppercases the organisation across two lines; mine did
 * neither.
 *
 * So this calls `renderBadgeHtml` with the same template the print run uses,
 * resolved the same way `conference-badges.ts` resolves it: active version,
 * else the newest draft.
 *
 * When there is NO template — true for CSC 2027 right now — it shows the
 * values as data and says so. An honest field list beats a convincing drawing
 * of something that does not exist yet.
 */
export default function BadgePreview({
  template,
  role,
  person,
}: {
  template: BadgeTemplateConfigV1 | null;
  role: BadgeRole;
  person: {
    displayName: string | null;
    roleTitle: string | null;
    organizationName: string | null;
  };
}) {
  if (!template) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
          What your badge will say
        </p>
        <dl className="mt-2 space-y-1 text-sm">
          <Row label="Name" value={person.displayName} />
          <Row label="Job title" value={person.roleTitle} />
          <Row label="Organisation" value={person.organizationName} />
        </dl>
        <p className="mt-2 text-xs text-gray-500">
          The badge design isn&rsquo;t finalised yet, so this is the wording rather than
          the layout. These are the words that will be printed.
        </p>
      </div>
    );
  }

  // Authored by CSC admins in the badge template editor, and rendered by the
  // same function the print pipeline uses — not a second interpretation of it.
  const html = renderBadgeHtml({
    template,
    role,
    side: "front",
    person: {
      displayName: person.displayName ?? "",
      roleTitle: person.roleTitle ?? "",
      organizationName: person.organizationName ?? "",
    } as Parameters<typeof renderBadgeHtml>[0]["person"],
  });

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
        Your badge
      </p>
      <div
        className="mt-2 overflow-hidden rounded-md border border-gray-300 bg-white"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <p className="mt-2 text-xs text-gray-500">
        Printed from your contact details. Anything wrong here is wrong on the badge.
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex gap-2">
      <dt className="w-28 shrink-0 text-gray-500">{label}</dt>
      <dd className={value?.trim() ? "text-gray-900" : "text-amber-800"}>
        {value?.trim() || "missing"}
      </dd>
    </div>
  );
}
