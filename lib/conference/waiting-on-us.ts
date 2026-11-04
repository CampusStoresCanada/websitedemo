import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { loadConferenceAsks, type ConferenceAsk } from "@/lib/actions/flags";
import { listSwapCapIncreaseRequests } from "@/lib/actions/conference-swaps";
import { loadBursaryApplications } from "@/lib/conference/bursary-widget";
import { loadSeatHoldings } from "@/lib/conference/seats";

/**
 * Everything where a person is waiting on CSC, in one list (Stephen,
 * 2026-10-23: a single "what are people waiting on" list).
 *
 * ⛔ No store of its own. Each source keeps its table, its reader and its
 * actions; this only lines them up, so a request is acted on in the War Room
 * whichever page it came from. The pages they come from keep their history.
 *
 *   ask       — Ask CSC from someone's own page, or one a staff member added
 *               (flags; loadConferenceAsks)
 *   swap_cap  — a delegate asking for more meeting swaps than the cap allows
 *               (swap_cap_increase_requests, status "requested")
 *   bursary   — a travel bursary request that asked for more help, which the
 *               board answers (conference_bursary_applications, status
 *               "submitted", with notes). A plain request waits on nobody:
 *               there is no approval step since 2026-11-02.
 *   bursary_prepay — a request that asked CSC to pay in advance, until staff
 *               mark the hotel and travel booked (prepay_booked_at).
 *
 * ⚠️ Travel-window exceptions are NOT here: they live in
 * conference_registrations, which nothing has written since registrations moved
 * to seats (0 rows, 2026-10-26). A queue item nobody can create is a dead row.
 */
export type WaitingItem = {
  kind: "ask" | "swap_cap" | "bursary" | "bursary_prepay";
  id: string;
  /** Who is waiting, and for whom they speak. */
  who: string | null;
  org: string | null;
  /** What they want, in their words where we have them. */
  what: string;
  /** What else we know: booth, now and next, contact, the reason they gave. */
  details: string | null;
  /** When they started waiting (ISO). */
  since: string;
  urgent: boolean;
  /** For an ask: Ask CSC, or the page it was raised on. */
  source?: string;
  /** For a swap-cap request: how many extra swaps. */
  extraSwaps?: number;
};

const OPEN_ASK = new Set(["open", "in_progress", "acknowledged"]);

function askSource(ask: ConferenceAsk): string {
  return ask.pageUrl.includes("war-room?ask=")
    ? "Ask CSC"
    : ask.pageUrl.split("/").slice(4).join("/").split("?")[0] || "War Room";
}

export type WaitingOnUs = {
  items: WaitingItem[];
  /** Asks already handled, newest first — the only history the War Room keeps. */
  doneAsks: ConferenceAsk[];
};

export async function loadWaitingOnUs(conferenceId: string): Promise<WaitingOnUs> {
  const db = createAdminClient();
  const [asks, capRequests, bursaries, { seats }] = await Promise.all([
    loadConferenceAsks(conferenceId),
    listSwapCapIncreaseRequests(conferenceId),
    loadBursaryApplications(conferenceId),
    loadSeatHoldings(db, { conferenceId, entityKinds: ["registration"] }),
  ]);

  const items: WaitingItem[] = [];

  for (const ask of asks) {
    if (!OPEN_ASK.has(ask.status)) continue;
    items.push({
      kind: "ask",
      id: ask.id,
      who: ask.flaggerName,
      org: null,
      what: ask.note ?? "(no note)",
      details: ask.details,
      since: ask.createdAt,
      urgent: ask.priority === "high",
      source: askSource(ask),
    });
  }

  // A seat names its holder and organization; the request names only the seat.
  const seatById = new Map(seats.map((s) => [s.seatId, s]));
  const orgIds = [...new Set(seats.map((s) => s.organizationId))];
  const { data: orgs } = orgIds.length
    ? await db.from("organizations").select("id, name").in("id", orgIds)
    : { data: [] as Array<{ id: string; name: string }> };
  const orgName = new Map((orgs ?? []).map((o) => [o.id as string, o.name as string]));

  for (const req of capRequests.success ? capRequests.data : []) {
    if (req.status !== "requested") continue;
    const seat = seatById.get(req.delegate_seat_id);
    items.push({
      kind: "swap_cap",
      id: req.id,
      who: seat?.holderName ?? null,
      org: seat ? orgName.get(seat.organizationId) ?? null : null,
      what: `${req.requested_extra_swaps} more meeting swap${req.requested_extra_swaps === 1 ? "" : "s"}`,
      details: req.reason,
      since: req.created_at,
      urgent: false,
      extraSwaps: req.requested_extra_swaps,
    });
  }

  for (const app of bursaries) {
    // Interest only, never submitted: that waits on the school, not on us.
    if (!app.request) continue;
    if (app.status === "submitted" && app.notes) {
      items.push({
        kind: "bursary",
        id: app.id,
        who: app.contactName,
        org: app.organizationName,
        what: "Asked for more travel help than the bursary covers",
        details: [app.notes, app.contactEmail, app.province].filter(Boolean).join(" · ") || null,
        since: app.request.submittedAt,
        urgent: false,
      });
    }
    // "Something clearly should tell us that they need us to pay in advance"
    // (Steve, 2026-11-02).
    if (app.request.payment === "prepay" && !app.request.prepayBookedAt && app.status !== "denied") {
      items.push({
        kind: "bursary_prepay",
        id: app.id,
        who: app.request.delegateName ?? app.contactName,
        org: app.organizationName,
        what: `Book ${[app.request.hotel && "hotel", app.request.travel && "travel"].filter(Boolean).join(" and ")} for ${app.organizationName}`,
        details:
          [
            app.request.hotel && app.request.hotelNights ? `${app.request.hotelNights} hotel nights` : null,
            app.contactEmail,
            app.province,
          ]
            .filter(Boolean)
            .join(" · ") || null,
        since: app.request.submittedAt,
        urgent: false,
      });
    }
  }

  // Urgent first, then whoever has waited longest.
  items.sort((a, b) => Number(b.urgent) - Number(a.urgent) || Date.parse(a.since) - Date.parse(b.since));

  return {
    items,
    doneAsks: asks.filter((a) => !OPEN_ASK.has(a.status)),
  };
}
