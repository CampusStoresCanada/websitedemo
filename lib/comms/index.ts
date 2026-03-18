// ─────────────────────────────────────────────────────────────────
// Chunk 22: Communications — Public API
// ─────────────────────────────────────────────────────────────────

export { sendTransactional, executeCampaignSend, createCampaign } from "./send";
export { triggerAutomation } from "./automation";
export { resolveAudience, previewAudience } from "./audience";
export { getTemplate, listTemplates, updateTemplate, renderTemplate, renderTemplateContent } from "./templates";
export type {
  TemplateKey,
  TemplateCategory,
  MessageTemplate,
  MessageCampaign,
  MessageRecipient,
  MessageDelivery,
  MessageAutomationRun,
  AudienceDefinition,
  AudienceType,
  ResolvedRecipient,
  TriggerAutomationOptions,
  CampaignStatus,
  DeliveryStatus,
} from "./types";
