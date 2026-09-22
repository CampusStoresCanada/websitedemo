import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { WORKSTREAMS } from "./committee-workstreams";
import { CAPABILITIES } from "@/lib/auth/capability-names";

/**
 * Telling someone they have been asked to do something.
 *
 * Appointing used to be silent: the capability landed in the database and the
 * person was never told, so the only way anyone learned they had committee
 * work was for a human to remember to email them separately. Every appointment
 * now carries its own invitation.
 *
 * Best-effort, always. Mail must never roll back an appointment that
 * succeeded — the governance record is the truth and the email is the
 * courtesy. Nothing in here throws; the caller gets a boolean it can ignore.
 *
 * Transactional, on the same footing as the survey invitation itself: this is
 * a direct consequence of a named act by the office, addressed to one person
 * about their own role. It is not a broadcast, and someone who unsubscribed
 * from conference marketing still needs to be told what they have been asked
 * to do. A dead mailbox is still filtered, by lib/email/send.ts.
 */

interface TaskCopy {
  title: string;
  summary: string;
  whatYouDo: string;
  timeCommitment: string;
  window: string;
  href: string;
}

/** The capabilities a person can be invited to, and how to describe each. */
function taskFor(capability: string): TaskCopy | null {
  const w = WORKSTREAMS.find((x) => x.capability === capability);
  if (w) {
    return {
      title: w.title,
      summary: w.summary,
      whatYouDo: w.whatYouDo,
      timeCommitment: w.timeCommitment,
      window: w.window,
      href: w.href,
    };
  }
  if (capability === CAPABILITIES.BENCHMARKING_COMMITTEE_LEAD) {
    return {
      title: "Committee lead",
      summary:
        "Bring people in for each piece of work, and keep an eye on how it is going.",
      whatYouDo:
        "You decide who takes on question review, interpretation and recipient confirmation, and you can see at a glance how far each one has got.",
      timeCommitment: "A few minutes to bring someone in",
      window: "Across the survey cycle",
      href: "/benchmarking/committee",
    };
  }
  // Elections capabilities and anything added later: no invitation copy yet,
  // so say nothing rather than send something generic and confusing.
  return null;
}

async function emailForProfile(profileId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin.auth.admin.getUserById(profileId);
  return data?.user?.email ?? null;
}

async function firstNameForProfile(profileId: string): Promise<string> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("display_name")
    .eq("id", profileId)
    .maybeSingle();
  const full = (data?.display_name as string | null)?.trim();
  // First name only. "Hi Tina" reads like a person wrote it; "Hi Tina Shannon"
  // reads like a mail merge, which is what it is, and saying so does not help.
  return full ? full.split(/\s+/)[0] : "there";
}

/**
 * The work deadline, in plain words.
 *
 * A calendar date, formatted in UTC rather than through a timezone, which
 * would shift it a day. Deliberately NOT derived from term_end: that is when
 * access expires, and using it here once told a reviewer they had until
 * December for something wanted within the week.
 */
function formatDue(dueDate: string): string {
  const [y, m, d] = dueDate.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export async function sendAppointmentInvitation(input: {
  subjectId: string;
  capability: string;
  /** When the work is due. Absent means the invitation names no deadline. */
  dueDate?: string;
}): Promise<{ sent: boolean; reason?: string }> {
  try {
    const task = taskFor(input.capability);
    if (!task) return { sent: false, reason: "no invitation copy for this capability" };

    const to = await emailForProfile(input.subjectId);
    if (!to) return { sent: false, reason: "no email address on file" };

    const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
    const firstName = await firstNameForProfile(input.subjectId);

    const { sendTransactional } = await import("@/lib/comms/send");
    const result = await sendTransactional({
      templateKey: "benchmarking_committee_invitation",
      to,
      variables: {
        first_name: firstName,
        task_title: task.title,
        task_summary: task.summary,
        what_you_do: task.whatYouDo,
        time_commitment: task.timeCommitment,
        window: task.window,
        task_url: `${appUrl}${task.href}`,
        // The whole sentence, or nothing at all. renderTemplate has no
        // conditionals through sendTransactional, so a line can only
        // disappear cleanly if the caller declines to send it.
        deadline_line: input.dueDate
          ? `<p><strong>Please finish by ${formatDue(input.dueDate)}.</strong></p>`
          : "",
      },
    });
    return { sent: result.success, reason: result.error };
  } catch (err) {
    console.error("[benchmarking] appointment invitation failed:", err);
    return {
      sent: false,
      reason: err instanceof Error ? err.message : "send failed",
    };
  }
}
