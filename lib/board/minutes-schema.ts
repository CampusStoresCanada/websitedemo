/**
 * JSON Schema for `data.json`, the drafting step's only output.
 *
 * This is the machine-enforceable half of `skills/csc-board-minutes/references/
 * data_schema.md`. That document explains the shape to a person; this constrains
 * the model so a draft that doesn't validate cannot be returned at all. Keep the
 * two in step — the doc is the source of truth for meaning, this for structure.
 *
 * Structured-output constraints: every object needs `additionalProperties:
 * false` and an explicit `required`; no recursion; no numeric or string range
 * constraints. See the Structured Outputs section of the claude-api reference.
 */

const richLine = {
  type: "object",
  properties: {
    text: { type: "string" },
    underline: { type: "boolean" },
    bold: { type: "boolean" },
  },
  required: ["text"],
  additionalProperties: false,
} as const;

/** The seven block shapes, discriminated by `type`. */
const block = {
  anyOf: [
    {
      type: "object",
      properties: { type: { const: "sectionHeading" }, text: { type: "string" } },
      required: ["type", "text"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: { type: { const: "item" }, num: { type: "string" }, title: { type: "string" } },
      required: ["type", "num", "title"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: { type: { const: "subitem" }, num: { type: "string" }, title: { type: "string" } },
      required: ["type", "num", "title"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: { type: { const: "body" }, text: { type: "string" }, indent: { type: "integer" } },
      required: ["type", "text"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: { type: { const: "bullet" }, text: { type: "string" }, indent: { type: "integer" } },
      required: ["type", "text"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: { type: { const: "motion" }, lines: { type: "array", items: richLine } },
      required: ["type", "lines"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        type: { const: "action" },
        label: { type: "string", enum: ["ACTION", "MOTION"] },
        text: { type: "string" },
        indent: { type: "integer" },
      },
      required: ["type", "label", "text"],
      additionalProperties: false,
    },
  ],
} as const;

export const MINUTES_DATA_SCHEMA = {
  type: "object",
  properties: {
    meetingTitle: { type: "string" },
    meetingDateLong: { type: "string" },
    footerDate: { type: "string" },
    present: { type: "array", items: { type: "string" } },
    absent: { type: "array", items: { type: "string" } },
    blocks: { type: "array", items: block },
    recap: {
      type: "object",
      properties: {
        decided: { type: "array", items: { type: "string" } },
        outstanding: { type: "array", items: { type: "string" } },
        nextMeeting: { type: "array", items: { type: "string" } },
      },
      required: ["decided", "outstanding", "nextMeeting"],
      additionalProperties: false,
    },
    // Where the model's uncertainty goes when there is no chat window to say it
    // in. Shown to the reviewer above the draft — it is the first thing a human
    // should check, so it is required rather than optional (an empty array is a
    // claim that nothing was assumed).
    assumptions: { type: "array", items: { type: "string" } },
  },
  required: [
    "meetingTitle",
    "meetingDateLong",
    "footerDate",
    "present",
    "absent",
    "blocks",
    "recap",
    "assumptions",
  ],
  additionalProperties: false,
} as const;

export interface MinutesData {
  meetingTitle: string;
  meetingDateLong: string;
  footerDate: string;
  present: string[];
  absent: string[];
  blocks: Array<Record<string, unknown>>;
  recap: { decided: string[]; outstanding: string[]; nextMeeting: string[] };
  assumptions: string[];
}
