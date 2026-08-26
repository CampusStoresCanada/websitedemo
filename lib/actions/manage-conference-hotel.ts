"use server";

import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseHotelRates, type HotelRate } from "@/lib/conference/hotel";
import type { Json } from "@/lib/database.types";
import { logAuditEventSafe } from "@/lib/ops/audit";
import { revalidatePath } from "next/cache";

export interface ConferenceHotelSettings {
  hotel_booking_url: string | null;
  hotel_booking_cutoff: string | null;
  hotel_rates: HotelRate[];
  hotel_note: string | null;
}

interface SaveHotelResult {
  success: boolean;
  settings?: ConferenceHotelSettings;
  error?: string;
}

/**
 * Save the hotel block details for a conference.
 *
 * Deliberately its own action rather than a few more entries in
 * CONFERENCE_UPDATE_FIELDS: updateConference() locks every field it owns once
 * the conference leaves draft, and rightly so — venue, dates and tax rates
 * shouldn't move under a published conference. The room block is the opposite
 * kind of fact. The link typically doesn't exist when the conference is
 * announced, the cutoff gets extended, and rates get corrected — all while the
 * conference is live. Requiring a super-admin override to paste a booking link
 * would mean the link doesn't get pasted.
 *
 * Same shape as manage-conference-documents.ts, which edits `documents` on the
 * same table for the same reason.
 */
export async function saveConferenceHotel(
  conferenceId: string,
  input: {
    bookingUrl: string | null;
    bookingCutoff: string | null;
    rates: HotelRate[];
    note: string | null;
  }
): Promise<SaveHotelResult> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();

  const { data: conference, error: fetchError } = await adminClient
    .from("conference_instances")
    .select("id, year, edition_code")
    .eq("id", conferenceId)
    .single();

  if (fetchError || !conference) {
    return { success: false, error: "Conference not found" };
  }

  const bookingUrl = input.bookingUrl?.trim() || null;
  if (bookingUrl) {
    let parsed: URL;
    try {
      parsed = new URL(bookingUrl);
    } catch {
      return { success: false, error: "Booking link must be a full URL, including https://" };
    }
    // A booking link is something a member clicks from a public page. Anything
    // other than http(s) — javascript:, data: — has no business being rendered
    // into an href from admin-entered text.
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { success: false, error: "Booking link must be an http(s) URL" };
    }
  }

  const cutoff = input.bookingCutoff?.trim() || null;
  if (cutoff && !/^\d{4}-\d{2}-\d{2}$/.test(cutoff)) {
    return { success: false, error: "Booking cutoff must be a date (YYYY-MM-DD)" };
  }

  const cleanRates: HotelRate[] = [];
  for (const rate of input.rates) {
    const label = rate.label?.trim();
    if (!label) return { success: false, error: "Every rate needs a room type label" };
    if (!Number.isFinite(rate.rate_cents) || rate.rate_cents < 0) {
      return { success: false, error: `"${label}" needs a nightly rate` };
    }
    cleanRates.push({
      id: rate.id,
      label,
      rate_cents: Math.round(rate.rate_cents),
      ...(rate.note?.trim() ? { note: rate.note.trim() } : {}),
    });
  }

  const { data: updated, error: updateError } = await adminClient
    .from("conference_instances")
    .update({
      hotel_booking_url: bookingUrl,
      hotel_booking_cutoff: cutoff,
      hotel_rates: cleanRates as unknown as Json,
      hotel_note: input.note?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", conferenceId)
    .select("hotel_booking_url, hotel_booking_cutoff, hotel_rates, hotel_note")
    .single();

  if (updateError) {
    return { success: false, error: updateError.message };
  }

  await logAuditEventSafe({
    action: "conference_hotel_updated",
    entityType: "conference_instance",
    entityId: conferenceId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: {
      booking_link_set: Boolean(bookingUrl),
      booking_cutoff: cutoff,
      rate_count: cleanRates.length,
      note_set: Boolean(input.note?.trim()),
    },
  });

  // The widget renders on the public conference page, which is cached — an
  // admin who pastes the link should see it live, not on the next rebuild.
  revalidatePath(`/conference/${conference.year}/${conference.edition_code}`);
  revalidatePath(`/admin/conference/${conferenceId}/hotel`);

  return {
    success: true,
    settings: {
      hotel_booking_url: updated.hotel_booking_url,
      hotel_booking_cutoff: updated.hotel_booking_cutoff,
      hotel_rates: parseHotelRates(updated.hotel_rates),
      hotel_note: updated.hotel_note,
    },
  };
}
