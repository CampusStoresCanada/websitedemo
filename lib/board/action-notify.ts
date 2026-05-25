/**
 * Action item notification helpers — Butler Ghost DMs via Circle.
 *
 * Sends rich-text DMs with clickable links using Circle's ProseMirror format.
 * Uses getCircleGhostClient().sendDirectMessageRich() — same pattern as
 * flag-notify and explain-dm.
 */

import { getCircleGhostClient } from "@/lib/circle/client";
import { isCircleConfigured } from "@/lib/circle/config";
import { sendEmail } from "@/lib/email/send";
import { buildActionIcs } from "@/lib/board/action-ics";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://campusstores.ca";

export interface ActionItemNotifyParams {
  itemId:          string;
  title:           string;
  description:     string | null;
  dueDate:         string | null;  // YYYY-MM-DD
  completeToken:   string;
  meetingDate:     string;         // YYYY-MM-DD
  assigneeEmails:  string[];
  mode:            "created" | "reminder" | "pre_meeting";
  // For ICS attachment (creation only)
  status?:         string;
  createdAt?:      string;
}

// ─── ProseMirror node builders ────────────────────────────────────────────────

type PMNode = Record<string, unknown>;

function para(...nodes: PMNode[]): PMNode {
  return { type: "paragraph", content: nodes };
}

function emptyPara(): PMNode {
  return { type: "paragraph" };
}

function text(t: string, bold = false): PMNode {
  const node: PMNode = { type: "text", text: t };
  if (bold) node.marks = [{ type: "bold" }];
  return node;
}

function link(label: string, href: string): PMNode {
  return {
    type: "text",
    text: label,
    marks: [{ type: "link", attrs: { href, target: "_blank" } }],
  };
}

// ─── Message builders ─────────────────────────────────────────────────────────

function buildContent(params: ActionItemNotifyParams): { content: PMNode[]; fallback: string } {
  const { title, description, dueDate, completeToken, meetingDate, mode } = params;

  const completeUrl = `${APP_URL}/api/board/action/${completeToken}`;
  const icsUrl      = `${APP_URL}/api/board/action/${completeToken}/ics`;
  const dueLine     = dueDate ? `Due: ${dueDate}` : "No due date set";

  const gcalTitle   = encodeURIComponent(title);
  const gcalDetails = encodeURIComponent(`${description ?? ""}\n\nMark complete: ${completeUrl}`.trim());
  const gcalDates   = dueDate ? `${dueDate.replace(/-/g, "")}/${dueDate.replace(/-/g, "")}` : "";
  const gcalUrl     = dueDate
    ? `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${gcalTitle}&dates=${gcalDates}&details=${gcalDetails}`
    : "";

  if (mode === "created") {
    const content: PMNode[] = [
      para(text(title, true)),
      para(text(`From the ${meetingDate} board meeting`)),
      ...(description ? [emptyPara(), para(text(description))] : []),
      emptyPara(),
      para(text(dueLine)),
      emptyPara(),
      ...(dueDate ? [para(link("📆 Add to Google Calendar", gcalUrl))] : []),
      para(link("📥 Add to Outlook Tasks / Reminders (.ics)", icsUrl)),
      para(link("✅ Mark as complete", completeUrl)),
    ];
    const fallback = `New action item: ${title}\n${dueLine}\nMark complete: ${completeUrl}`;
    return { content, fallback };
  }

  if (mode === "reminder") {
    const content: PMNode[] = [
      para(text(title, true)),
      para(text("This action item is due soon.")),
      ...(description ? [emptyPara(), para(text(description))] : []),
      emptyPara(),
      para(text(dueLine)),
      emptyPara(),
      para(link("✅ Mark as complete", completeUrl)),
    ];
    const fallback = `Reminder: ${title}\n${dueLine}\nMark complete: ${completeUrl}`;
    return { content, fallback };
  }

  // pre_meeting
  const content: PMNode[] = [
    para(text(title, true)),
    para(text("This item is still open heading into the next board meeting.")),
    ...(description ? [emptyPara(), para(text(description))] : []),
    emptyPara(),
    para(text(dueLine)),
    emptyPara(),
    para(link("✅ Mark as complete", completeUrl)),
  ];
  const fallback = `Pre-meeting reminder: ${title}\n${dueLine}\nMark complete: ${completeUrl}`;
  return { content, fallback };
}

// ─── Public helper ────────────────────────────────────────────────────────────

/**
 * Send action item notifications via two channels:
 *   1. Email via Resend — with .ics attached on creation
 *   2. Circle DM via Butler Ghost
 *
 * Fails silently per recipient — one bad address doesn't block others.
 */
export async function notifyActionItemAssignees(
  params: ActionItemNotifyParams
): Promise<void> {
  if (params.assigneeEmails.length === 0) return;

  const { content, fallback } = buildContent(params);
  const emailSubject = buildEmailSubject(params);
  const emailHtml    = buildEmailHtml(params);

  // Build .ics attachment for creation notifications
  const icsAttachment = params.mode === "created" && params.createdAt
    ? [{
        filename: `csc-action-${params.itemId.slice(0, 8)}.ics`,
        content:  buildActionIcs({
          id:            params.itemId,
          title:         params.title,
          description:   params.description,
          dueDate:       params.dueDate,
          status:        params.status ?? "open",
          completeToken: params.completeToken,
          createdAt:     params.createdAt,
        }),
      }]
    : undefined;

  const ghost = isCircleConfigured() ? getCircleGhostClient() : null;

  await Promise.allSettled(
    params.assigneeEmails.map(async (email) => {
      // Channel 1: Email with optional .ics attachment
      await sendEmail({
        to:          email,
        subject:     emailSubject,
        html:        emailHtml,
        attachments: icsAttachment,
      }).catch((e) => console.warn(`[action-notify] Email failed for ${email}:`, e));

      // Channel 2: Circle DM via Butler Ghost
      if (ghost) {
        const result = await ghost.sendDirectMessageRich(email, content, fallback);
        if (!result.success && !result.selfDm) {
          console.warn(`[action-notify] DM failed for ${email}:`, result.error);
        }
      }
    })
  );
}

// ─── Email builders ───────────────────────────────────────────────────────────

function buildEmailSubject(params: ActionItemNotifyParams): string {
  const { title, mode } = params;
  if (mode === "created")     return `Action Item: ${title}`;
  if (mode === "reminder")    return `Reminder: ${title}`;
  return `Pre-meeting: ${title}`;
}

function buildEmailHtml(params: ActionItemNotifyParams): string {
  const { title, description, dueDate, completeToken, meetingDate, mode } = params;

  const completeUrl = `${APP_URL}/api/board/action/${completeToken}`;
  const dueLine     = dueDate ? `Due: ${dueDate}` : "No due date set";

  const descBlock = description
    ? `<p style="margin:0 0 16px;color:#374151;font-size:14px;">${description}</p>`
    : "";

  const icsNote = mode === "created"
    ? `<p style="margin:0 0 24px;font-size:13px;color:#6B7280;">
         The attached <strong>.ics file</strong> can be opened in Outlook to add this as a task.
       </p>`
    : "";

  const intro =
    mode === "created"    ? `You've been assigned a new CSC board action item from the <strong>${meetingDate}</strong> meeting.` :
    mode === "reminder"   ? `This is a reminder that the following action item is due soon.` :
    `This action item is still open ahead of the next board meeting.`;

  return `
    <h2 style="margin:0 0 8px;font-size:20px;color:#163D6D;">${title}</h2>
    <p style="margin:0 0 20px;color:#6B7280;font-size:14px;">${intro}</p>
    ${descBlock}
    <p style="margin:0 0 20px;font-size:14px;color:#374151;"><strong>${dueLine}</strong></p>
    ${icsNote}
    <p style="margin:0 0 24px;">
      <a href="${completeUrl}"
         style="background-color:#163D6D;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600;font-size:14px;">
        ✅ Mark as Complete
      </a>
    </p>
    <p style="margin:0;font-size:12px;color:#9CA3AF;">
      Campus Stores Canada — Board Portal
    </p>
  `;
}
