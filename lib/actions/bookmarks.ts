"use server";

import { requireAuthenticated } from "@/lib/auth/guards";

export interface Bookmark {
  id: string;
  url: string;
  title: string;
  note: string | null;
  element_selector: string | null;
  element_end_selector: string | null;
  element_text: string | null;
  created_at: string;
}

const SELECT_FIELDS = "id, url, title, note, element_selector, element_end_selector, element_text, created_at";

/** Fetch all bookmarks for the current user, newest first. */
export async function getUserBookmarks(): Promise<{ bookmarks: Bookmark[]; error?: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { bookmarks: [], error: "Not authenticated" };

  const { supabase, userId } = auth.ctx;
  const { data, error } = await supabase
    .from("user_bookmarks")
    .select(SELECT_FIELDS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) return { bookmarks: [], error: "Failed to load bookmarks" };
  return { bookmarks: data as unknown as Bookmark[] };
}

/** Check if the given URL is already bookmarked by the current user. */
export async function isBookmarked(url: string): Promise<boolean> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return false;

  const { supabase, userId } = auth.ctx;
  const { data } = await supabase
    .from("user_bookmarks")
    .select("id")
    .eq("user_id", userId)
    .eq("url", url)
    .maybeSingle();

  return !!data;
}

/** Add a bookmark. Returns the new bookmark or an error. */
export async function addBookmark(
  url: string,
  title: string,
  note?: string,
  elementSelector?: string,
  elementEndSelector?: string,
  elementText?: string,
): Promise<{ bookmark?: Bookmark; error?: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { error: "Not authenticated" };

  const { supabase, userId } = auth.ctx;
  const { data, error } = await supabase
    .from("user_bookmarks")
    .insert({
      user_id: userId,
      url,
      title,
      note: note?.trim() || null,
      element_selector: elementSelector || null,
      element_end_selector: elementEndSelector || null,
      element_text: elementText?.slice(0, 400) || null,
    })
    .select(SELECT_FIELDS)
    .single();

  if (error) {
    if (error.code === "23505") return { error: "Already bookmarked" };
    return { error: "Failed to save bookmark" };
  }
  return { bookmark: data as unknown as Bookmark };
}

/** Remove a bookmark by its URL. */
export async function removeBookmark(url: string): Promise<{ error?: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { error: "Not authenticated" };

  const { supabase, userId } = auth.ctx;
  const { error } = await supabase
    .from("user_bookmarks")
    .delete()
    .eq("user_id", userId)
    .eq("url", url);

  if (error) return { error: "Failed to remove bookmark" };
  return {};
}

/** Update the note on an existing bookmark. */
export async function updateBookmarkNote(id: string, note: string): Promise<{ error?: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { error: "Not authenticated" };

  const { supabase, userId } = auth.ctx;
  const { error } = await supabase
    .from("user_bookmarks")
    .update({ note: note.trim() || null })
    .eq("id", id)
    .eq("user_id", userId);

  if (error) return { error: "Failed to update note" };
  return {};
}
