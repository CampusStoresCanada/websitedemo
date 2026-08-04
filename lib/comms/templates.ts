// ─────────────────────────────────────────────────────────────────
// Chunk 22: Communications — Template Engine
// {{variable}} substitution plus {{#if key}}...{{/if}} block inclusion,
// keyed against pre-computed booleans (see lib/comms/conditions/) — no
// JS eval, no arbitrary expressions, just "show this block or don't".
// ─────────────────────────────────────────────────────────────────

import { createAdminClient } from "@/lib/supabase/admin";
import { renderBlocksToHtml } from "./blocks/render";
import { extractCustomVariableKeys } from "./variables/extract";
import type { ContentBlock } from "./blocks/types";
import type { MessageTemplate, TemplateKey } from "./types";

/**
 * Strip (or keep) {{#if key}}...{{/if}} blocks based on a flags map.
 * Non-nested only — a block's own content isn't scanned for further
 * {{#if}} blocks, matching the engine's "simple, not a scripting
 * language" scope. Unknown keys (no matching flag) render as false.
 */
export function renderConditionalBlocks(template: string, flags: Record<string, boolean>): string {
  return template.replace(/\{\{#if\s+([a-zA-Z0-9_-]+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, key, content) =>
    flags[key] ? content : ""
  );
}

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
 * Render subject + body for a template with given variables. Conditional
 * blocks are resolved first (against `flags`), then variables are
 * substituted inside whatever content survives.
 */
export function renderTemplateContent(
  template: MessageTemplate,
  variables: Record<string, string | number | boolean | null | undefined>,
  flags: Record<string, boolean> = {}
): { subject: string; bodyHtml: string } {
  return {
    subject: renderTemplate(renderConditionalBlocks(template.subject, flags), variables),
    bodyHtml: renderTemplate(renderConditionalBlocks(template.body_html, flags), variables),
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
 * Load a template by its database id — what message_campaigns.template_id
 * actually stores (a UUID, not a key). Use this, not getTemplate, when
 * resolving a campaign's template.
 */
export async function getTemplateById(id: string): Promise<MessageTemplate | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("message_templates")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    console.error(`[comms/templates] Failed to load template id '${id}':`, error);
    return null;
  }
  return data as MessageTemplate;
}

/**
 * List templates. By default returns only shared-library templates
 * (campaign_id is null) — pass campaignId to get one campaign's roster of
 * forked/blank-started emails instead.
 */
export async function listTemplates(options?: {
  category?: string;
  campaignId?: string;
}): Promise<MessageTemplate[]> {
  const supabase = createAdminClient();
  let q = supabase.from("message_templates").select("*").order("category").order("name");
  if (options?.category) q = q.eq("category", options.category);
  q = options?.campaignId ? q.eq("campaign_id", options.campaignId) : q.is("campaign_id", null);
  const { data, error } = await q;
  if (error) {
    console.error("[comms/templates] listTemplates error:", error);
    return [];
  }
  return (data ?? []) as MessageTemplate[];
}

function slugify(text: string): string {
  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "template";
}

/**
 * `key` is a machine identifier (template lookup by system automation,
 * template selection in admin forms) — it was never meant to be something
 * an admin invents by hand, so it's derived from the name rather than
 * required as input. Not guaranteed globally unique on its own (two
 * templates can share a name), hence the random suffix.
 */
function generateTemplateKey(name: string): string {
  return `${slugify(name)}_${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Create a new custom (non-system) template. Pass campaignId to create it
 * as a campaign-scoped email instead of a shared-library template —
 * forkedFromTemplateId records lineage when it started as a fork rather
 * than blank.
 */
export async function createTemplate(data: {
  /** Auto-generated from `name` when omitted — see generateTemplateKey. */
  key?: string;
  name: string;
  description?: string;
  category: import("./types").TemplateCategory;
  subject: string;
  body_html: string;
  campaignId?: string;
  forkedFromTemplateId?: string;
  /** Operational/transactional — bypasses unsubscribe preferences (CASL-exempt). Defaults to false (commercial). */
  isTransactional?: boolean;
  /** Visual-builder authoring data — when set, body_html is recomputed from this, not trusted from the caller. */
  bodyBlocks?: ContentBlock[];
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const supabase = createAdminClient();
  const finalBodyHtml = data.bodyBlocks ? renderBlocksToHtml(data.bodyBlocks) : data.body_html;
  const { data: row, error } = await supabase
    .from("message_templates")
    .insert({
      key: data.key ?? generateTemplateKey(data.name),
      name: data.name,
      description: data.description ?? null,
      category: data.category,
      subject: data.subject,
      body_html: finalBodyHtml,
      body_blocks: data.bodyBlocks ? (data.bodyBlocks as unknown as import("@/lib/database.types").Json) : null,
      // Derived from the content itself, not hand-declared — see
      // extractCustomVariableKeys. A variable that's removed from the
      // subject/body drops off here automatically on the next save.
      variable_keys: extractCustomVariableKeys(data.subject, finalBodyHtml),
      is_system: false,
      is_transactional: data.isTransactional ?? false,
      campaign_id: data.campaignId ?? null,
      forked_from_template_id: data.forkedFromTemplateId ?? null,
    })
    .select("id")
    .single();

  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true, id: row.id };
}

/**
 * Fork a library template into a campaign — copies its current content
 * into a new, independently-editable row. Editing the fork afterward never
 * touches the original or any other campaign using it.
 */
export async function forkTemplateIntoCampaign(
  sourceTemplateId: string,
  campaignId: string
): Promise<{ success: boolean; id?: string; error?: string }> {
  const supabase = createAdminClient();
  const { data: source, error: loadErr } = await supabase
    .from("message_templates")
    .select("name, description, category, subject, body_html, body_blocks")
    .eq("id", sourceTemplateId)
    .single();

  if (loadErr || !source) {
    return { success: false, error: loadErr?.message ?? "Source template not found" };
  }

  // variable_keys isn't copied — createTemplate recomputes it from the
  // (identical, just-copied) subject/body, which lands on the same set.
  return createTemplate({
    key: `campaign-${campaignId}-${crypto.randomUUID()}`,
    name: source.name,
    description: source.description ?? undefined,
    category: source.category as import("./types").TemplateCategory,
    subject: source.subject,
    body_html: source.body_html,
    bodyBlocks: (source.body_blocks as unknown as ContentBlock[] | null) ?? undefined,
    campaignId,
    forkedFromTemplateId: sourceTemplateId,
  });
}

/**
 * Update a template's subject/body. System templates can be updated but not deleted.
 */
export async function updateTemplate(
  id: string,
  patch: {
    subject?: string;
    body_html?: string;
    name?: string;
    description?: string;
    is_transactional?: boolean;
    /** Visual-builder authoring data — when set, body_html is recomputed from this, not trusted from the caller. */
    bodyBlocks?: ContentBlock[];
  }
): Promise<{ success: boolean; error?: string }> {
  const supabase = createAdminClient();
  const { bodyBlocks, ...rest } = patch;
  const update: Record<string, unknown> = { ...rest, updated_at: new Date().toISOString() };

  let finalBodyHtml = patch.body_html;
  if (bodyBlocks) {
    finalBodyHtml = renderBlocksToHtml(bodyBlocks);
    update.body_html = finalBodyHtml;
    update.body_blocks = bodyBlocks as unknown as import("@/lib/database.types").Json;
  }

  // variable_keys is always recomputed from the final subject+body, never
  // client-supplied — see extractCustomVariableKeys. Only worth the extra
  // fetch when subject or body could actually have changed.
  if (patch.subject !== undefined || finalBodyHtml !== undefined) {
    const { data: current } = await supabase.from("message_templates").select("subject, body_html").eq("id", id).single();
    const subject = patch.subject ?? current?.subject ?? "";
    const bodyHtml = finalBodyHtml ?? current?.body_html ?? "";
    update.variable_keys = extractCustomVariableKeys(subject, bodyHtml);
  }

  const { error } = await supabase.from("message_templates").update(update).eq("id", id);

  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true };
}
