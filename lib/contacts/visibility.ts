/**
 * Where a person appears, decided by that person.
 *
 * Pure and DB-free so both the website and the print pipeline resolve the same
 * way from the same rules — the two must never drift, because one of them is
 * permanent.
 *
 * ⚠️ This is the person's own decision. An org admin confirms their
 * ORGANISATION's details; they have no say in who is listed, and there is no
 * admin override — an override that stands in for someone's silence is opt-out
 * with a different label.
 */

/** The three states a person can choose. */
export type DirectoryVisibility = "hidden" | "members" | "public";

export const DIRECTORY_VISIBILITY_OPTIONS: ReadonlyArray<{
  value: DirectoryVisibility;
  label: string;
  detail: string;
}> = [
  {
    value: "public",
    label: "Anyone",
    detail: "Your name, title and contact details appear on public pages, to signed-in members, and in the printed directory.",
  },
  {
    value: "members",
    label: "Members and partners only",
    detail: "Signed-in members and partners can find you, and you appear in the printed directory. Not shown on public pages.",
  },
  {
    value: "hidden",
    label: "Nobody",
    detail: "You are not listed anywhere, and not printed. Campus Stores Canada administrators can still see you.",
  },
];

/** Who is looking. Administrators always see everyone — that is not a choice. */
export type Viewer = "admin" | "member" | "public";

export interface VisibilitySource {
  directory_visibility?: string | null;
  /** Legacy opt-out. Still governs the website while the choice is undecided. */
  hidden?: boolean | null;
}

const isVisibility = (v: unknown): v is DirectoryVisibility =>
  v === "hidden" || v === "members" || v === "public";

/** Has this person actually answered? */
export const hasDecided = (c: VisibilitySource): boolean =>
  isVisibility(c.directory_visibility);

/**
 * What the WEBSITE should do with this person.
 *
 * Undecided falls back to the legacy `hidden` flag, so nothing moves for the
 * ~880 people who never opted out while they are being asked. A deliberate
 * choice: flipping them to hidden would empty the directories overnight and
 * punish people for a question they have not been asked yet.
 */
export function resolveWebVisibility(c: VisibilitySource): DirectoryVisibility {
  if (isVisibility(c.directory_visibility)) return c.directory_visibility;
  return c.hidden === true ? "hidden" : "members";
}

/** Can this viewer see this person on the website? */
export function isVisibleTo(c: VisibilitySource, viewer: Viewer): boolean {
  if (viewer === "admin") return true;
  const v = resolveWebVisibility(c);
  if (v === "hidden") return false;
  return viewer === "member" ? true : v === "public";
}

/**
 * May this person be PRINTED?
 *
 * Strict opt-in, and deliberately NOT the same rule as the website: undecided
 * is out. Paper cannot be corrected, so it takes an explicit yes. Silence
 * prints nobody — which is the whole difference between this and an opt-out.
 */
export function canPrint(c: VisibilitySource): boolean {
  return c.directory_visibility === "members" || c.directory_visibility === "public";
}
