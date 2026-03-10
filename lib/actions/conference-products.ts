"use server";

import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/database.types";

type ProductRow = Database["public"]["Tables"]["conference_products"]["Row"];
type ProductInsert = Database["public"]["Tables"]["conference_products"]["Insert"];
type ProductUpdate = Database["public"]["Tables"]["conference_products"]["Update"];
type RuleRow = Database["public"]["Tables"]["conference_product_rules"]["Row"];
type RuleInsert = Database["public"]["Tables"]["conference_product_rules"]["Insert"];

// ─────────────────────────────────────────────────────────────────
// Products CRUD
// ─────────────────────────────────────────────────────────────────

export async function getProducts(
  conferenceId: string
): Promise<{ success: boolean; error?: string; data?: ProductRow[] }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("conference_products")
    .select("*")
    .eq("conference_id", conferenceId)
    .order("display_order", { ascending: true });

  if (error) return { success: false, error: error.message };
  return { success: true, data: data ?? [] };
}

export async function createProduct(
  input: Omit<ProductInsert, "id" | "created_at" | "current_sold">
): Promise<{ success: boolean; error?: string; data?: ProductRow }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("conference_products")
    .insert(input)
    .select()
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, data };
}

export async function updateProduct(
  id: string,
  input: ProductUpdate
): Promise<{ success: boolean; error?: string; data?: ProductRow }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("conference_products")
    .update(input)
    .eq("id", id)
    .select()
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, data };
}

export async function deleteProduct(
  id: string
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { error } = await adminClient
    .from("conference_products")
    .delete()
    .eq("id", id);

  if (error) return { success: false, error: error.message };
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────
// Product Rules CRUD
// ─────────────────────────────────────────────────────────────────

export async function getRules(
  productId: string
): Promise<{ success: boolean; error?: string; data?: RuleRow[] }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("conference_product_rules")
    .select("*")
    .eq("product_id", productId)
    .order("display_order", { ascending: true });

  if (error) return { success: false, error: error.message };
  return { success: true, data: data ?? [] };
}

export async function createRule(
  input: Omit<RuleInsert, "id">
): Promise<{ success: boolean; error?: string; data?: RuleRow }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("conference_product_rules")
    .insert(input)
    .select()
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, data };
}

export async function updateRule(
  id: string,
  input: Partial<Omit<RuleInsert, "id">>
): Promise<{ success: boolean; error?: string; data?: RuleRow }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("conference_product_rules")
    .update(input)
    .eq("id", id)
    .select()
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, data };
}

export async function deleteRule(
  id: string
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { error } = await adminClient
    .from("conference_product_rules")
    .delete()
    .eq("id", id);

  if (error) return { success: false, error: error.message };
  return { success: true };
}
