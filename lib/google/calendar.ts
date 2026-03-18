// ─────────────────────────────────────────────────────────────────
// Google Calendar — service account helper
// Creates calendar events with auto-generated Google Meet links.
// Credentials sourced from GOOGLE_SERVICE_ACCOUNT_JSON env var.
// Non-fatal: all errors are returned as { ok: false } never thrown.
// ─────────────────────────────────────────────────────────────────

import { google } from "googleapis";

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID ?? "";
const SA_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "";
const IMPERSONATE = process.env.GOOGLE_CALENDAR_IMPERSONATE ?? "";

function getCalendarClient() {
  if (!SA_JSON || !CALENDAR_ID) return null;

  const credentials = JSON.parse(SA_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/calendar"],
    // Impersonate a Workspace user so Meet links can be generated
    clientOptions: IMPERSONATE ? { subject: IMPERSONATE } : undefined,
  });

  return google.calendar({ version: "v3", auth });
}

export interface CreateCalendarEventOptions {
  /** Used as the idempotency key — same eventId = same Google Calendar event */
  eventId: string;
  title: string;
  startsAt: string;  // ISO string
  endsAt?: string | null;
  /** Emails to add as attendees (pre-accepted). Creator should be included here. */
  attendeeEmails?: string[];
}

export type CreateCalendarEventResult =
  | { ok: true; meetLink: string; googleEventId: string }
  | { ok: false; error: string };

/**
 * Create a Google Calendar event with a Meet link for a virtual CSC event.
 * Idempotent: uses eventId as the requestId so repeat calls return the same link.
 */
export async function createCalendarEventWithMeet(
  options: CreateCalendarEventOptions
): Promise<CreateCalendarEventResult> {
  const calendar = getCalendarClient();

  if (!calendar) {
    return { ok: false, error: "Google Calendar not configured (missing env vars)" };
  }

  if (!CALENDAR_ID) {
    return { ok: false, error: "GOOGLE_CALENDAR_ID not set" };
  }

  // Default end time: 1 hour after start if not provided
  const startDt = new Date(options.startsAt);
  const endDt = options.endsAt
    ? new Date(options.endsAt)
    : new Date(startDt.getTime() + 60 * 60 * 1000);

  try {
    const response = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      conferenceDataVersion: 1,
      requestBody: {
        summary: options.title,
        start: { dateTime: startDt.toISOString() },
        end: { dateTime: endDt.toISOString() },
        attendees: options.attendeeEmails?.map((email) => ({
          email,
          responseStatus: "accepted",
        })),
        conferenceData: {
          createRequest: {
            // Stable requestId = same Meet link on retry
            requestId: `csc-event-${options.eventId}`,
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
      },
    });

    const event = response.data;
    const meetLink = event.conferenceData?.entryPoints?.find(
      (ep) => ep.entryPointType === "video"
    )?.uri;

    if (!meetLink) {
      return { ok: false, error: "Google Calendar event created but no Meet link returned" };
    }

    return {
      ok: true,
      meetLink,
      googleEventId: event.id ?? "",
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/**
 * Add an attendee to an existing Google Calendar event.
 * Google will automatically send them a calendar invite email.
 * Uses patch with sendUpdates="externalOnly" so only the new attendee gets notified.
 * Idempotent — if the email is already an attendee the existing entry is preserved.
 */
export async function addAttendeeToCalendarEvent(
  googleEventId: string,
  email: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const calendar = getCalendarClient();
  if (!calendar || !CALENDAR_ID) return { ok: false, error: "Google Calendar not configured" };

  try {
    // Fetch current attendees so we can merge (patch replaces the whole attendees array)
    const existing = await calendar.events.get({
      calendarId: CALENDAR_ID,
      eventId: googleEventId,
    });

    const currentAttendees = existing.data.attendees ?? [];
    const alreadyAdded = currentAttendees.some(
      (a) => a.email?.toLowerCase() === email.toLowerCase()
    );

    if (alreadyAdded) return { ok: true };

    await calendar.events.patch({
      calendarId: CALENDAR_ID,
      eventId: googleEventId,
      sendUpdates: "externalOnly",
      requestBody: {
        attendees: [
          ...currentAttendees,
          { email, responseStatus: "accepted" },
        ],
      },
    });

    return { ok: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/**
 * Remove an attendee from a Google Calendar event.
 * Google will send them a cancellation notice.
 */
export async function removeAttendeeFromCalendarEvent(
  googleEventId: string,
  email: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const calendar = getCalendarClient();
  if (!calendar || !CALENDAR_ID) return { ok: false, error: "Google Calendar not configured" };

  try {
    const existing = await calendar.events.get({
      calendarId: CALENDAR_ID,
      eventId: googleEventId,
    });

    const filtered = (existing.data.attendees ?? []).filter(
      (a) => a.email?.toLowerCase() !== email.toLowerCase()
    );

    await calendar.events.patch({
      calendarId: CALENDAR_ID,
      eventId: googleEventId,
      sendUpdates: "externalOnly",
      requestBody: { attendees: filtered },
    });

    return { ok: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/**
 * Delete a Google Calendar event by its Google event ID.
 * Used when an event is cancelled.
 */
export async function deleteCalendarEvent(
  googleEventId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const calendar = getCalendarClient();
  if (!calendar || !CALENDAR_ID) return { ok: false, error: "Google Calendar not configured" };

  try {
    await calendar.events.delete({ calendarId: CALENDAR_ID, eventId: googleEventId });
    return { ok: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
