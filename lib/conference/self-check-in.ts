/**
 * Self check-in: an attendee checks themselves in with the QR code from their
 * email, at a kiosk (a locked desk device) or on their own phone.
 *
 * ⛔ OFF unless an admin turns it on, per conference. A conference with no
 * settings saved (every one today) has neither route, and the email carries no
 * check-in QR. Stephen, 2026-11-06: "I don't think we need to turn all of it on
 * automatically for CSC's conference this year."
 *
 * ⛔ Self check-in is not a second check-in. Both routes run the desk's own
 * scan (runCheckInScan): same token, same day rule, same agreements. Only who
 * pressed the button differs, and that is recorded, never inferred.
 *
 * What happens after they are in is the conference's choice, because every
 * conference runs pickup differently:
 *   - "desk"            collect the badge from staff
 *   - "bins"            pick it up from a labelled bin (by last name)
 *   - "spare_stickers"  take a spare card; the print station prints the stickers
 *                       (kiosk only: a phone cannot be trusted to send prints,
 *                       so a phone check-in falls back to "desk")
 */

export const SELF_CHECK_IN_ENDINGS = ["desk", "bins", "spare_stickers"] as const;
export type SelfCheckInEnding = (typeof SELF_CHECK_IN_ENDINGS)[number];

export type SelfCheckInBin = {
  /** What the sign over the bin says, e.g. "A to F". */
  label: string;
  /** First letter of the last names it holds, inclusive. */
  from: string;
  /** Last letter, inclusive. */
  to: string;
};

export type SelfCheckInSettings = {
  /** A desk device can be switched into a locked self check-in kiosk. */
  kiosk: boolean;
  /** The emailed link checks them in from their own phone, on conference days. */
  phone: boolean;
  ending: SelfCheckInEnding;
  /** For "bins". Checked in order; the first that holds the name wins. */
  bins: SelfCheckInBin[];
  /** Shown under the result, e.g. "Lanyards are on the table to your left." */
  note: string | null;
};

export const SELF_CHECK_IN_OFF: SelfCheckInSettings = {
  kiosk: false,
  phone: false,
  ending: "desk",
  bins: [],
  note: null,
};

const letter = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const first = value.trim().charAt(0).toUpperCase();
  return /^[A-Z]$/.test(first) ? first : null;
};

/** Whatever is stored, as settings. Anything unreadable is off. */
export function normalizeSelfCheckIn(value: unknown): SelfCheckInSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return SELF_CHECK_IN_OFF;
  const raw = value as Record<string, unknown>;
  const ending = SELF_CHECK_IN_ENDINGS.includes(raw.ending as SelfCheckInEnding)
    ? (raw.ending as SelfCheckInEnding)
    : "desk";
  const bins = Array.isArray(raw.bins)
    ? raw.bins.flatMap((bin) => {
        if (!bin || typeof bin !== "object") return [];
        const b = bin as Record<string, unknown>;
        const from = letter(b.from);
        const to = letter(b.to);
        const label = typeof b.label === "string" ? b.label.trim() : "";
        if (!from || !to || from > to) return [];
        return [{ label: label || (from === to ? from : `${from} to ${to}`), from, to }];
      })
    : [];
  const note = typeof raw.note === "string" && raw.note.trim() ? raw.note.trim().slice(0, 300) : null;
  return { kiosk: raw.kiosk === true, phone: raw.phone === true, ending, bins, note };
}

/** Is either route on? Nothing about self check-in shows anywhere until it is. */
export function selfCheckInEnabled(settings: SelfCheckInSettings): boolean {
  return settings.kiosk || settings.phone;
}

/**
 * The bin for a last name, or null when none holds it (the attendee is sent to
 * the desk rather than told a wrong bin). Accents fold: "Émond" is in E.
 */
export function binFor(lastName: string | null | undefined, bins: SelfCheckInBin[]): SelfCheckInBin | null {
  const first = (lastName ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .charAt(0)
    .toUpperCase();
  if (!/^[A-Z]$/.test(first)) return null;
  return bins.find((bin) => first >= bin.from && first <= bin.to) ?? null;
}

export type SelfCheckInRoute = "kiosk" | "phone";

export type SelfCheckInOutcome =
  | { kind: "desk" }
  | { kind: "bin"; label: string }
  | { kind: "spare_stickers" };

/** What a checked-in attendee is told to do next. */
export function outcomeFor(
  settings: SelfCheckInSettings,
  route: SelfCheckInRoute,
  lastName: string | null | undefined
): SelfCheckInOutcome {
  if (settings.ending === "bins") {
    const bin = binFor(lastName, settings.bins);
    return bin ? { kind: "bin", label: bin.label } : { kind: "desk" };
  }
  if (settings.ending === "spare_stickers") {
    return route === "kiosk" ? { kind: "spare_stickers" } : { kind: "desk" };
  }
  return { kind: "desk" };
}

/** What the attendee reads once they are in. Kiosk and phone say the same thing. */
export function selfCheckInOutcomeText(outcome: SelfCheckInOutcome): string {
  if (outcome.kind === "bin") return `Your badge is in the bin marked ${outcome.label}.`;
  if (outcome.kind === "spare_stickers") {
    return "Take a blank card from the stack. Your name stickers are printing now.";
  }
  return "Pick up your badge at the registration desk.";
}

/** Why a self check-in did not go through, in the attendee's words. */
export function selfCheckInRefusalText(state: string): string {
  if (state === "not_valid_today") return "Your registration does not cover today. Please see the registration desk.";
  if (state === "revoked_token" || state === "invalid_token" || state === "not_found") {
    return "We could not find your registration from this code. Please see the registration desk.";
  }
  return "We could not check you in. Please see the registration desk.";
}
