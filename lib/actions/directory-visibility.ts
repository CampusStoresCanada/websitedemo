"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticated } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import type { DirectoryVisibility } from "@/lib/contacts/visibility";

/**
 * A person sets their own listing visibility.
 *
 * ⚠️ Ownership is NOT "the email matches". Shared inboxes at these
 * organisations hold different humans — `store@somecollege.ca` can be three
 * people — so an email match would let one of them set another's visibility,
 * which is precisely the decision that belongs to nobody but its owner.
 *
 * So: a linked profile is proof. A bare email match is proof only when that
 * address belongs to exactly one contact row. Anything ambiguous is refused
 * and routed to a human, because guessing here guesses at someone's privacy.
 */
async function assertOwnership(
  db: ReturnType<typeof createAdminClient>,
  contactId: string,
  userId: string,
  userEmail: string | null | undefined
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: contact } = await db
    .from("contacts")
    .select("id, profile_id, email, work_email")
    .eq("id", contactId)
    .maybeSingle();
  if (!contact) return { ok: false, error: "That listing no longer exists." };

  if (contact.profile_id && contact.profile_id === userId) return { ok: true };

  const addresses = [contact.email, contact.work_email]
    .map((a) => a?.trim().toLowerCase())
    .filter((a): a is string => !!a);
  const mine = userEmail?.trim().toLowerCase();
  if (!mine || !addresses.includes(mine)) {
    return { ok: false, error: "That listing is not yours to change." };
  }

  // Shared address: more than one human behind it. Refuse rather than guess.
  const { count } = await db
    .from("contacts")
    .select("id", { count: "exact", head: true })
    .or(`email.eq.${mine},work_email.eq.${mine}`)
    .is("archived_at", null);
  if ((count ?? 0) > 1) {
    return {
      ok: false,
      error:
        "This address is shared by more than one person, so we can't tell which listing is yours. " +
        "Email info@campusstorescanada.ca and we'll set it for you.",
    };
  }
  return { ok: true };
}

export async function setMyDirectoryVisibility(
  contactId: string,
  choice: DirectoryVisibility
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error ?? "Please sign in." };

  if (choice !== "hidden" && choice !== "members" && choice !== "public") {
    return { success: false, error: "Unknown visibility option." };
  }

  const db = createAdminClient();
  const owned = await assertOwnership(db, contactId, auth.ctx.userId, auth.ctx.userEmail);
  if (!owned.ok) return { success: false, error: owned.error };

  const { error } = await db
    .from("contacts")
    .update({
      directory_visibility: choice,
      directory_visibility_set_at: new Date().toISOString(),
      // Kept in step so the legacy flag stays truthful: existing website reads
      // filter on `hidden`, and letting the two disagree would show someone who
      // just asked to be hidden.
      hidden: choice === "hidden",
      updated_at: new Date().toISOString(),
    })
    .eq("id", contactId);

  if (error) {
    console.error("[directory-visibility] update failed:", error);
    return { success: false, error: "Could not save that. Please try again." };
  }

  revalidatePath("/me");
  return { success: true };
}
