/**
 * One place that turns a saved definition into a composed publication.
 *
 * The browser page and the InDesign export must render the SAME book — if they
 * each assembled it, the online directory and the printed one would drift the
 * moment either changed, which is exactly the failure this whole model exists
 * to prevent. So both call this.
 */

import { composePublication, type ComposedPublication, type Publication } from "./composition";
import {
  loadEntriesForPublication,
  loadPlacementsForPublication,
  loadSurfacesForPublication,
} from "./composition-loader";
import { attachQrCodes } from "./qr";

/** Where the QR codes point. Printed, so it must never be localhost. */
export const publicBaseUrl = (): string =>
  process.env.NEXT_PUBLIC_APP_URL ?? "https://campusstores.ca";

/**
 * The conference a publication draws its floor plan from.
 *
 * A network directory's own source is the conference, but a member-only
 * directory has no conference at all and simply gets no map — rather than
 * failing, or guessing at one.
 */
function conferenceIdFor(publication: Publication): string | null {
  if (publication.source.kind === "conference") return publication.source.conferenceId;
  for (const section of publication.sections) {
    if ((section.type === "listings" || section.type === "people") && section.source?.kind === "conference") {
      return section.source.conferenceId;
    }
  }
  return null;
}

export async function composeSavedPublication(
  publication: Publication,
  options: { withQrCodes?: boolean } = {}
): Promise<ComposedPublication> {
  const conferenceId = conferenceIdFor(publication);

  const surfaces = conferenceId ? await loadSurfacesForPublication(conferenceId) : [];
  const [bySource, placements] = await Promise.all([
    loadEntriesForPublication(publication),
    conferenceId ? loadPlacementsForPublication(conferenceId, surfaces) : Promise.resolve([]),
  ]);

  if (!options.withQrCodes) return composePublication(publication, bySource, surfaces, placements);

  // QR codes are referenced by filename in the XML, not embedded — but the
  // codes have to be on the entries for those references to be emitted at all.
  const withQr = new Map(
    await Promise.all(
      [...bySource].map(
        async ([key, entries]) => [key, await attachQrCodes(entries, publicBaseUrl())] as const
      )
    )
  );
  return composePublication(publication, withQr, surfaces, placements);
}
