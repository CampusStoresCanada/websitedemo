/**
 * The check-in desk at an event's door — the rules, with no database.
 *
 * ⛔ Not a second desk (Stephen, 2026-10-20). It is THIS desk with an event
 * picked: same camera, cards, Find and Sell. What changes is which event a scan
 * is for, and the question it asks — "is this event in their access?"
 * (resolveAccess), never the desk's day rule.
 *
 * The picked event is remembered per device until its window closes, so a
 * reception choice cannot leak into the next morning's badge pickup.
 */

import { zonedWallTimeToUtcIso } from "@/lib/conference/tz";

/** An hour either side: early arrivals, and reconciling against the paper list after. */
export const DOOR_MARGIN_MINUTES = 60;

export type DoorEvent = {
  id: string;
  name: string;
  /** The event's day, `YYYY-MM-DD`. */
  date: string;
  /** Wall times at the venue, `HH:MM`. */
  startTime: string;
  endTime: string;
  /**
   * Has a cap. ⛔ The doors are the capped events (check-in model §3: the
   * Meet & Greet, the Wednesday Offsite, the Tuesday Evening Trade Show) — not
   * the Keynote or "Downtime". Only these are OFFERED automatically; staff can
   * still pick any event by hand (e.g. the CANCOLL AGM).
   */
  capped: boolean;
};

/** What a device remembers: the event, and the instant the choice lapses. */
export type DoorChoice = { entityId: string; until: string };

/** The event's window as instants: margin before the start to margin after the end. */
export function doorWindow(event: DoorEvent, timeZone: string): { opens: number; closes: number } {
  const start = Date.parse(zonedWallTimeToUtcIso(event.date, event.startTime, timeZone));
  let end = Date.parse(zonedWallTimeToUtcIso(event.date, event.endTime, timeZone));
  // An evening that runs past midnight ends on the next calendar day.
  if (end <= start) end += 24 * 60 * 60 * 1000;
  const margin = DOOR_MARGIN_MINUTES * 60 * 1000;
  return { opens: start - margin, closes: end + margin };
}

/** The capped events whose window is open at `now` — what the desk offers. */
export function doorEventsOpenNow(events: DoorEvent[], now: Date, timeZone: string): DoorEvent[] {
  const t = now.getTime();
  return events
    .filter((event) => event.capped)
    .filter((event) => {
      const { opens, closes } = doorWindow(event, timeZone);
      return t >= opens && t <= closes;
    })
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
}

/**
 * When a pick lapses. Picked inside its window: when the window closes. Picked
 * by hand outside it (reconciling afterwards, or an uncapped event like an
 * AGM): the end of the window if that is still ahead, otherwise two hours from
 * now — long enough to work through a paper list, short enough not to linger.
 */
export function doorChoiceUntil(event: DoorEvent, now: Date, timeZone: string): string {
  const { closes } = doorWindow(event, timeZone);
  const fallback = now.getTime() + 2 * 60 * 60 * 1000;
  return new Date(Math.max(closes, fallback)).toISOString();
}

/** Is a remembered pick still good, and still one of this conference's events? */
export function doorChoiceStillValid(choice: DoorChoice | null, events: DoorEvent[], now: Date): boolean {
  if (!choice) return false;
  if (!events.some((event) => event.id === choice.entityId)) return false;
  const until = Date.parse(choice.until);
  return Number.isFinite(until) && now.getTime() < until;
}

/** The device's memory of the pick: a cookie, read and written in the browser. */
export const doorCookieName = (conferenceId: string) => `desk-door-${conferenceId}`;

export function parseDoorChoice(raw: string | null | undefined): DoorChoice | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as Partial<DoorChoice>;
    return typeof parsed.entityId === "string" && typeof parsed.until === "string"
      ? { entityId: parsed.entityId, until: parsed.until }
      : null;
  } catch {
    return null;
  }
}

export function serializeDoorChoice(choice: DoorChoice): string {
  return encodeURIComponent(JSON.stringify(choice));
}
