import type { BuildEntity } from "../actions/conference-entities";
import { resolveAccess } from "./entity-commerce";

export type OverlapResult = {
  overlapping: boolean;
  conflictingEntityId: string | null;
  conflictingEntityName: string | null;
};

const NO_OVERLAP: OverlapResult = { overlapping: false, conflictingEntityId: null, conflictingEntityName: null };

/**
 * Does `targetEntityId` cover a day that some already-held registration also
 * covers? A Full Conference Registration resolves to every conference day; a
 * single Day Pass resolves to just its one day — holding both means paying
 * twice for the same day, which is what this catches (as a warning to fix,
 * not a block — there may be a real reason, like a mid-cycle upgrade in
 * progress). Booths and other non-registration holdings are ignored: this is
 * about one person's redundant attendance, not everything an org owns.
 */
export function findOverlappingRegistration(
  targetEntityId: string,
  heldEntityIds: string[],
  byId: Map<string, BuildEntity>
): OverlapResult {
  const targetDays = new Set(
    [...resolveAccess([targetEntityId], byId)].filter((id) => byId.get(id)?.kind === "day")
  );
  if (targetDays.size === 0) return NO_OVERLAP;

  for (const heldId of heldEntityIds) {
    if (heldId === targetEntityId) continue;
    const held = byId.get(heldId);
    if (!held || held.kind !== "registration") continue;
    const heldDays = resolveAccess([heldId], byId);
    for (const dayId of heldDays) {
      if (targetDays.has(dayId)) {
        return { overlapping: true, conflictingEntityId: heldId, conflictingEntityName: held.name };
      }
    }
  }
  return NO_OVERLAP;
}
