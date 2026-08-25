"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { networkDirectory } from "@/lib/publication/composition";
import { savePublication } from "@/lib/publication/store";

/**
 * Create a network directory seeded from the preset.
 *
 * A starting definition, not a locked pipeline — it is saved as ordinary rows
 * the moment it exists, so editing a section is editing data rather than
 * shipping code.
 */
export async function createNetworkDirectory(conferenceId: string) {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false as const, error: auth.error ?? "Admins only." };

  const db = createAdminClient();
  const { data: conference } = await db
    .from("conference_instances")
    .select("id, name, year")
    .eq("id", conferenceId)
    .maybeSingle();
  if (!conference) return { success: false as const, error: "Conference not found." };

  const preset = networkDirectory(conference.id, `Campus Stores Canada ${conference.year} Directory`);
  const result = await savePublication({
    name: `Network Directory ${conference.year}`,
    title: preset.title,
    source: preset.source,
    selection: preset.selection,
    sections: preset.sections,
  });

  if (result.success) revalidatePath("/admin/publications");
  return result;
}
