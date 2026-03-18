// ─────────────────────────────────────────────────────────────────
// Chunk 22: Communications — Template Engine
// Safe {{variable}} substitution only — no JS eval, no logic
// ─────────────────────────────────────────────────────────────────

import { createAdminClient } from "@/lib/supabase/admin";
import type { MessageTemplate, TemplateKey } from "./types";

/**
 * Render a template string by substituting {{variable}} tokens.
 * Missing variables are left as empty string. No logic execution.
 */
export function renderTemplate(
  template: string,
  variables: Record<string, string | number | boolean | null | undefined>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = variables[key];
    if (val === null || val === undefined) return "";
    return String(val);
  });
}

/**
 * Render subject + body for a template with given variables.
 */
export function renderTemplateContent(
  template: MessageTemplate,
  variables: Record<string, string | number | boolean | null | undefined>
): { subject: string; bodyHtml: string } {
  return {
    subject: renderTemplate(template.subject, variables),
    bodyHtml: renderTemplate(template.body_html, variables),
  };
}

/**
 * Load a template by key from the database.
 */
export async function getTemplate(
  key: TemplateKey
): Promise<MessageTemplate | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("message_templates")
    .select("*")
    .eq("key", key)
    .single();

  if (error) {
    console.error(`[comms/templates] Failed to load template '${key}':`, error);
    return null;
  }
  return data as MessageTemplate;
}

/**
 * List all templates, optionally filtered by category.
 */
export async function listTemplates(category?: string): Promise<MessageTemplate[]> {
  const supabase = createAdminClient();
  let q = supabase.from("message_templates").select("*").order("category").order("name");
  if (category) q = q.eq("category", category);
  const { data, error } = await q;
  if (error) {
    console.error("[comms/templates] listTemplates error:", error);
    return [];
  }
  return (data ?? []) as MessageTemplate[];
}

/**
 * Create a new custom (non-system) template.
 */
export async function createTemplate(data: {
  key: string;
  name: string;
  description?: string;
  category: import("./types").TemplateCategory;
  subject: string;
  body_html: string;
  variable_keys?: string[];
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const supabase = createAdminClient();
  const { data: row, error } = await supabase
    .from("message_templates")
    .insert({
      key: data.key,
      name: data.name,
      description: data.description ?? null,
      category: data.category,
      subject: data.subject,
      body_html: data.body_html,
      variable_keys: data.variable_keys ?? [],
      is_system: false,
    })
    .select("id")
    .single();

  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true, id: row.id };
}

/**
 * Update a template's subject/body. System templates can be updated but not deleted.
 */
export async function updateTemplate(
  id: string,
  patch: { subject?: string; body_html?: string; name?: string; description?: string }
): Promise<{ success: boolean; error?: string }> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("message_templates")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true };
}
