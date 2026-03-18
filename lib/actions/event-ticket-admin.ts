"use server";

import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import type { EventTicketType, AudienceFilter } from "@/lib/events/tickets";

interface TicketTypePayload {
  event_id: string;
  name: string;
  description: string | null;
  price_cents: number;
  capacity: number | null;
  sort_order: number;
  audience_filter: AudienceFilter | null;
  available_from: string | null;
  available_until: string | null;
  is_hidden: boolean;
}

export async function createTicketType(
  payload: TicketTypePayload
): Promise<{ success: true; data: EventTicketType } | { success: false; error: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: "Access denied" };

  const { data, error } = await createAdminClient()
    .from("event_ticket_types")
    .insert({ ...payload, updated_at: new Date().toISOString() })
    .select()
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, data: data as EventTicketType };
}

export async function updateTicketType(
  id: string,
  payload: Partial<TicketTypePayload>
): Promise<{ success: true; data: EventTicketType } | { success: false; error: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: "Access denied" };

  const { data, error } = await createAdminClient()
    .from("event_ticket_types")
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, data: data as EventTicketType };
}

export async function deleteTicketType(
  id: string
): Promise<{ success: true } | { success: false; error: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: "Access denied" };

  // Don't allow deleting a ticket type that has paid registrations
  const { count } = await createAdminClient()
    .from("event_registrations")
    .select("id", { count: "exact", head: true })
    .eq("ticket_type_id", id)
    .in("payment_status", ["paid", "pending"]);

  if ((count ?? 0) > 0) {
    return {
      success: false,
      error: `Cannot delete — ${count} registration(s) exist for this ticket type.`,
    };
  }

  const { error } = await createAdminClient()
    .from("event_ticket_types")
    .delete()
    .eq("id", id);

  if (error) return { success: false, error: error.message };
  return { success: true };
}
