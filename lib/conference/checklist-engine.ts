import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAudience } from "@/lib/comms/audience";
import { createCampaign, executeCampaignSend } from "@/lib/comms/send";
import type { AudienceDefinition } from "@/lib/comms/types";
import { CHECK_TYPES, type CheckType } from "./checklist-check-types";
import { getTaskCta } from "./checklist-cta";
import { CHECKS, evaluateChecklistTaskCheck } from "./checklist-checks";
import { formatDayMonth } from "@/lib/time/supabase-timestamp";
import { checklistEmailSuppressed, deriveCheckpointOffsets } from "./checklist-cadence";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * The fixed, developer-maintained vocabulary of "is this done" checks. Every
 * task on every checklist, for every conference, must pick one of these —
 * each reads something the site already captures. There is deliberately no
 * way to define a check outside this registry; if a new kind of task is
 * needed, the underlying capture has to exist first, then a check type gets
 * added here.
 */
/**
 * The framing sentence and the consent ask, both per checklist.
 *
 * The body used to hardcode "still has a few things to finish for the 2027 CSC
 * Conference". That is true for Booth Readiness and WRONG for Directory
 * Listing, which since 2026-08-24 also reaches 52 member stores — they are in
 * the book because they are in the network, not because they are exhibiting.
 *
 * A publication-scoped checklist is about the printed book, so it says so, and
 * it carries the consent ask: the listing prints real contact details for real
 * people, and paper cannot be corrected afterwards.
 *
 * ⚠️ Consent to be printed is **per person** and the admin has NO role in it —
 * not even a fail-safe. Two earlier versions of this copy got it wrong: the
 * first told the admin to remove anyone who did not want to appear, the second
 * still presented consent as part of what they were approving. Both made one
 * person the gatekeeper for everyone else's privacy, and a fail-safe that lets
 * an admin stand in for silence is just opt-OUT with a different label.
 *
 * What is left here is a single informational line so the admin is not
 * surprised when their staff get asked. It states plainly that there is nothing
 * for them to do. The ask itself goes to each person.
 */
function renderFraming(checklist: {
  publication_id?: string | null;
  deadline_at: string;
  publicationTitle?: string | null;
}, conferenceYear: number): { intro_line: string; consent_note: string } {
  if (!checklist.publication_id) {
    return {
      intro_line:
        `still has a few things to finish for the <strong>${conferenceYear} CSC Conference</strong>:`,
      consent_note: "",
    };
  }

  // ⚠️ Hand-rolled parsing here shipped "goes to press on NaN undefined" to a
  // real inbox: the guard checked only for a trailing "Z", so a timestamp that
  // already carried "+00" got a Z appended and became invalid. Formatting is in
  // Eastern, because a 23:59 deadline formatted in UTC lands on the next day.
  const deadline = formatDayMonth(checklist.deadline_at) ?? "the deadline";
  const title = checklist.publicationTitle?.trim() || `${conferenceYear} Campus Stores Canada Directory`;

  return {
    intro_line:
      `has an entry in the <strong>${title}</strong> — the printed directory that ships to ` +
      `every member store and goes out at the conference. It goes to press on ` +
      `<strong>${deadline}</strong>, and a few things still need you:`,
    // Informational, NOT a task. The admin is told their staff are being asked
    // so nobody is blindsided when the ask lands — and told explicitly that it
    // is not theirs to action, because anything they could "action" here would
    // be them consenting on someone else's behalf.
    consent_note: `<p style="margin:18px 0 0;font-size:14px;color:#6b7280;line-height:1.55">
  Separately, everyone from your organisation listed in the book is being asked, for
  themselves, whether they want their name and contact details printed. Nobody appears
  without their own yes, and there is nothing for you to do about that here.
</p>`,
  };
}

/** Org names carry ampersands — "Cutter & Buck" would break the markup. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * One card per outstanding thing, carrying its OWN deadline and saying plainly
 * whether we can see the answer.
 *
 * Two additions the ED asked for, both about not making people guess:
 *
 *  - The day count comes from the item, not the list. A supplier order closing
 *    on the 10th and a badge check closing on the 18th are not "45 days until
 *    January", and a reader who is told they are stops believing the number.
 *
 *  - A self-reported item says we cannot see it. We know whether a seat is
 *    assigned or an invoice is paid; we have no idea whether a hotel got
 *    booked or a pallet shipped. Chasing someone for something they finished
 *    three weeks ago, in the same voice as something genuinely outstanding, is
 *    how a reminder series teaches people to ignore it.
 */
function renderOpenItemsHtml(
  items: {
    name: string;
    description: string;
    deadline: string | null;
    selfReported: boolean;
    hardensBecause: string | null;
    cta: { label: string; url: string };
  }[]
): string {
  const today = new Date();
  return items
    .map((item) => {
      const days = item.deadline
        ? Math.ceil((new Date(item.deadline).getTime() - today.getTime()) / 86_400_000)
        : null;
      const when =
        days === null
          ? ""
          : days < 0
            ? `<span style="color:#b91c1c;font-weight:600">Closed ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago</span>`
            : days === 0
              ? `<span style="color:#b91c1c;font-weight:600">Closes today</span>`
              : days <= 7
                ? `<span style="color:#b45309;font-weight:600">${days} day${days === 1 ? "" : "s"} left</span>`
                : `<span style="color:#6b7280">${days} days left</span>`;
      // No apology and no accusation. It states what we can see, which is the
      // honest reason they are hearing from us about something they may well
      // have already done.
      /*
        WHY the date matters, not just that it exists.

        The org page has said this all along — "By 4 January, or anyone you
        have not named is not in the attendee list members use to find who to
        meet, and their badge is printed on site rather than in advance" —
        and the email, the thing actually doing the asking, said only "4 days
        left". A bare countdown gives someone no reason to act today rather
        than on the last day, which is the behaviour the lead-in cadence
        exists to prevent.

        Steve: "the due date isn't when we should start reminding people...
        its when the results become a bigger pain in the ass to change."
        This is the sentence that says what the pain is.
      */
      const consequence = item.hardensBecause
        ? `<p style="margin:6px 0 0;color:#6b7280;font-size:13px;line-height:1.5">After that, ${item.hardensBecause}.</p>`
        : "";
      const unverified = item.selfReported
        ? `<p style="margin:8px 0 0;color:#6b7280;font-size:13px;line-height:1.5">We have no way to see this one from our side, so we are asking. If it is already handled, tell us and we will stop bringing it up.</p>`
        : "";
      return `<div style="margin:12px 0;padding:12px;border:1px solid #e5e7eb;border-radius:8px">
  <p style="margin:0 0 4px;font-weight:600;color:#111827">${item.name}</p>
  <p style="margin:0 0 6px;font-size:13px">${when}</p>
  <p style="margin:0 0 8px;color:#6b7280;font-size:14px">${item.description}</p>
  ${consequence}
  ${unverified}
  <a href="${item.cta.url}" style="color:#163D6D;font-weight:600;text-decoration:none;font-size:14px;display:inline-block;margin-top:8px">${item.cta.label} →</a>
</div>`;
    })
    .join("\n");
}

interface DueOrg {
  organizationId: string;
  checkpointId: string;
}

/**
 * For one checklist, find orgs in scope with a checkpoint due today that
 * hasn't already been logged for them. If multiple checkpoints are
 * simultaneously overdue (e.g. cron missed a few days), only the most
 * recent unlogged one is returned per org — never a backlog burst.
 */
/**
 * Which organisations does this checklist speak to?
 *
 * Two scopes, because two different questions:
 *
 *  - **Purchasers** (default) — orgs with an `entity_balances` row for the
 *    conference. Right for "you bought a booth, now assign staff and pay".
 *  - **Publication** — every org listed in a saved publication. Right for
 *    "your entry is going to print, check it". Measured 2026-08-24: purchaser
 *    scoping reached 30 of the 123 organisations in the network directory —
 *    NONE of the 52 member stores — so 93 orgs printed data that nothing ever
 *    asked them to confirm.
 *
 * A directory is a network artifact even when it ships inside a conference box.
 * Scoping the loop to buyers meant the loop could never maintain the book.
 */
/**
 * The organisations a checklist is responsible for.
 *
 * Exported because the org page has to ask the same question. It used to
 * answer it by not asking: `loadOrgTasks` rendered every active checklist to
 * every org, so member stores were shown "Order power and AV from Encore" for
 * a booth they do not have. Two surfaces, two different wrong answers — the
 * fix is that there is only one place the question is answered.
 */
export async function resolveScopedOrgs(
  db: AdminClient,
  checklist: {
    id: string;
    conference_id: string;
    scope_entity_id: string | null;
    scope_entity_kind?: string | null;
    publication_id?: string | null;
  }
): Promise<string[]> {
  if (checklist.publication_id) {
    const { loadPublication } = await import("@/lib/publication/store");
    const { loadEntriesForPublication } = await import("@/lib/publication/composition-loader");
    const { composePublication } = await import("@/lib/publication/composition");

    const saved = await loadPublication(checklist.publication_id);
    // A checklist pointing at a deleted or unparseable publication must reach
    // NOBODY rather than silently falling back to purchasers — that would mail
    // the wrong population about the wrong thing.
    if (!saved) return [];

    const bySource = await loadEntriesForPublication(saved.publication);
    const doc = composePublication(saved.publication, bySource);
    // doc.entries is already deduped across sections, so an exhibiting partner
    // is asked once, not once per section they appear in.
    return doc.entries.map((e) => e.orgId);
  }

  let orgQuery = db
    .from("entity_balances")
    .select("organization_id")
    .eq("conference_id", checklist.conference_id)
    .not("organization_id", "is", null);
  if (checklist.scope_entity_id) {
    orgQuery = orgQuery.eq("entity_id", checklist.scope_entity_id);
  }
  /**
   * A KIND of thing held, not a particular one — "whoever has a booth", which
   * scope_entity_id cannot say because the booths are 60 separate entities.
   *
   * Resolved as two queries rather than an embedded join: an embed here reads
   * as a seat/entity read to anyone skimming it, and a kind that matches no
   * entity must return NOBODY rather than silently dropping the restriction.
   */
  if (checklist.scope_entity_kind) {
    const { data: kindRows } = await db
      .from("conference_entities")
      .select("id")
      .eq("conference_id", checklist.conference_id)
      .eq("kind", checklist.scope_entity_kind);
    const kindIds = (kindRows ?? []).map((r) => r.id);
    if (kindIds.length === 0) return [];
    orgQuery = orgQuery.in("entity_id", kindIds);
  }
  const { data: orgRows } = await orgQuery;
  return [...new Set((orgRows ?? []).map((r) => r.organization_id).filter((id): id is string => !!id))];
}

/**
 * Drop the tasks this org has no business being asked.
 *
 * Most checks scope themselves — `seat_assigned` reports done when the org
 * holds nothing of that kind, `legal_document_accepted` resolves documents by
 * conference tier. A `self_reported` task cannot: there is nothing to read, so
 * "have you ordered power for your booth?" is asked of a member store with no
 * booth unless the task says who it is for.
 *
 * One query per distinct kind, not per task, and through resolveScopedOrgs so
 * the org page and the reminder email keep answering this the same way.
 */
export async function filterTasksToOrgScope<
  T extends { scope_entity_kind?: string | null; scope_entity_id?: string | null }
>(
  db: AdminClient,
  conferenceId: string,
  organizationId: string,
  tasks: T[]
): Promise<T[]> {
  const kinds = [...new Set(tasks.map((t) => t.scope_entity_kind).filter((k): k is string => !!k))];
  const entityIds = [...new Set(tasks.map((t) => t.scope_entity_id).filter((id): id is string => !!id))];
  if (kinds.length === 0 && entityIds.length === 0) return tasks;

  const holdsKind = new Map<string, boolean>();
  for (const kind of kinds) {
    const orgs = await resolveScopedOrgs(db, {
      id: `task-scope:${kind}`,
      conference_id: conferenceId,
      scope_entity_id: null,
      scope_entity_kind: kind,
      publication_id: null,
    });
    holdsKind.set(kind, orgs.includes(organizationId));
  }

  /**
   * Holdings of ONE named thing, rather than a class of them.
   *
   * "Ship your Conference in a Box" cannot be scoped by kind: that
   * entity is an `item`, and so are the folding tables and chairs bundled with
   * every booth, so a kind scope would ask every exhibitor to ship a care
   * package they never bought.
   *
   * One query covering every scoped entity, not one per task. A balance is a
   * balance whether the org paid for it or a booth's `includes` granted it, so
   * a Connected Exhibitor is scoped in by the same read as a buyer.
   */
  const holdsEntity = new Set<string>();
  if (entityIds.length > 0) {
    const { data } = await db
      .from("entity_balances")
      .select("entity_id")
      .eq("conference_id", conferenceId)
      .eq("organization_id", organizationId)
      .in("entity_id", entityIds);
    for (const row of data ?? []) {
      if (row.entity_id) holdsEntity.add(row.entity_id as string);
    }
  }

  // Both restrictions are AND-ed: a task may name a kind, a thing, or both.
  return tasks.filter(
    (t) =>
      (!t.scope_entity_kind || holdsKind.get(t.scope_entity_kind) === true) &&
      (!t.scope_entity_id || holdsEntity.has(t.scope_entity_id))
  );
}

export interface ChecklistDigest {
  orgName: string;
  openItems: {
    name: string;
    description: string;
    /** This item's own deadline, falling back to the list's. */
    deadline: string | null;
    /** True when only the org can tell us — we cannot verify it ourselves. */
    selfReported: boolean;
    /** What changes on the deadline, in the reader's terms. */
    hardensBecause: string | null;
    /** Rotating subject copy for a reminder that leads with this task. */
    subjectLines: string[];
    cta: { label: string; url: string };
  }[];
  variables: Record<string, string>;
}

/**
 * The digest for ONE organisation — the open items and the variables the
 * template needs.
 *
 * Extracted so the "send a test to myself" path runs the SAME code as the real
 * send. A test that builds its own approximation of the email tells you nothing
 * about the email that will actually go out.
 *
 * Returns null when the org has nothing open: that is the same silence the real
 * run uses, and a test send should reproduce it rather than inventing content.
 */
export async function buildChecklistDigest(
  checklist: { id: string; name: string; conference_id: string; deadline_at: string; publication_id?: string | null; publicationTitle?: string | null },
  conference: { year: number; edition_code: string },
  organizationId: string,
  db: AdminClient = createAdminClient()
): Promise<ChecklistDigest | null> {
  const { data: org } = await db.from("organizations").select("name, slug").eq("id", organizationId).single();
  if (!org) return null;

  const { data: tasks } = await db
    .from("conference_checklist_tasks")
    .select("id, name, description, check_type, check_entity_id, scope_entity_kind, scope_entity_id, deadline_at, hardens_because, subject_lines")
    .eq("checklist_id", checklist.id)
    .eq("active", true)
    .eq("audience", "org")
    .order("sort_order", { ascending: true });

  const inScope = await filterTasksToOrgScope(
    db, checklist.conference_id, organizationId, tasks ?? []
  );

  const openItems: ChecklistDigest["openItems"] = [];
  for (const task of inScope) {
    const checkType = task.check_type as CheckType;
    const complete = await CHECKS[checkType]({
      db, organizationId, conferenceId: checklist.conference_id,
      entityId: task.check_entity_id, taskId: task.id,
    });
    if (!complete) {
      openItems.push({
        name: task.name,
        description: task.description,
        // Each item's OWN date, falling back to the list's. A list used to
        // carry one date for every task on it, so "45 days until 11 January"
        // was the only urgency anyone saw, whether the thing in front of them
        // closed a week earlier or a week later.
        deadline: (task.deadline_at as string | null) ?? checklist.deadline_at,
        // Can we see the answer ourselves, or are we taking their word?
        selfReported: checkType === "self_reported",
        hardensBecause: (task.hardens_because as string | null) ?? null,
        subjectLines: ((task.subject_lines as string[] | null) ?? []).filter(Boolean),
        cta: getTaskCta(checkType, {
          orgSlug: org.slug,
          conferenceId: checklist.conference_id,
          conferenceYear: conference.year,
          conferenceEdition: conference.edition_code,
          organizationId,
          taskId: task.id,
        }),
      });
    }
  }
  if (openItems.length === 0) return null;

  const framing = renderFraming(checklist, conference.year);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://campusstores.ca";
  return {
    orgName: org.name,
    openItems,
    variables: {
      /**
       * Where this list lives, so nobody has to keep the email to find it.
       *
       * Two destinations because an org admin is also a person and holds two
       * separate lists: the company's items (which is what this email is) and
       * their own. Sending them to one and letting them discover the other is
       * how the "conflicting messages" problem started.
       */
      where_to_track:
        `<p style="margin:18px 0 0;font-size:13px;color:#6b7280;line-height:1.55">` +
        `You don't need to keep this email — ${escapeHtml(org.name)}'s list is always at ` +
        `<a href="${appUrl}/org/${org.slug}#conference_checklist" style="color:#163D6D">your organisation's page</a>, ` +
        `and anything that's yours personally is at ` +
        `<a href="${appUrl}/me#conference_checklist" style="color:#163D6D">your own conference page</a>.` +
        `</p>`,
      org_name: org.name,
      checklist_name: checklist.name,
      open_items_html: renderOpenItemsHtml(openItems),
      conference_year: String(conference.year),
      ...framing,
    },
  };
}

/**
 * Make sure this checklist has the checkpoints its tasks imply.
 *
 * Idempotent and self-healing: it inserts only the offsets that are missing,
 * so adding a task with an earlier deadline widens the schedule on the next
 * run and nothing a human typed is removed. An existing hand-authored offset
 * is left exactly where it is — this adds reach, it never takes it away.
 */
async function ensureDerivedCheckpoints(
  db: AdminClient,
  checklist: { id: string; deadline_at: string },
  /** False on a dry run: say which offsets are missing, write nothing. */
  write = true
): Promise<number[]> {
  const [{ data: tasks }, { data: existing }] = await Promise.all([
    db
      .from("conference_checklist_tasks")
      .select("deadline_at")
      .eq("checklist_id", checklist.id)
      .eq("active", true)
      .not("deadline_at", "is", null)
      .order("deadline_at", { ascending: true })
      .limit(1),
    db
      .from("conference_checklist_checkpoints")
      .select("days_before_deadline")
      .eq("checklist_id", checklist.id),
  ]);

  const earliest = tasks?.[0]?.deadline_at ? new Date(tasks[0].deadline_at as string) : null;
  const wanted = deriveCheckpointOffsets(new Date(checklist.deadline_at), earliest);
  const have = new Set((existing ?? []).map((c) => c.days_before_deadline as number));
  const missing = wanted.filter((d) => !have.has(d));
  if (missing.length === 0 || !write) return missing;

  await db.from("conference_checklist_checkpoints").insert(
    missing.map((days_before_deadline) => ({ checklist_id: checklist.id, days_before_deadline }))
  );
  return [];
}

/** A checkpoint a dry run would have created: never logged, so never sent. */
const UNSAVED_CHECKPOINT = "unsaved:";

async function findDueOrgs(
  db: AdminClient,
  checklist: {
    id: string; conference_id: string; scope_entity_id: string | null;
    scope_entity_kind?: string | null; deadline_at: string; publication_id?: string | null;
  },
  dryRun = false
): Promise<DueOrg[]> {
  // Derived, not typed in. See lib/conference/checklist-cadence.ts. A dry run
  // writes nothing, so the offsets it would add stand in unsaved.
  const unsaved = await ensureDerivedCheckpoints(db, checklist, !dryRun);

  const { data: saved } = await db
    .from("conference_checklist_checkpoints")
    .select("id, days_before_deadline")
    .eq("checklist_id", checklist.id)
    .order("days_before_deadline", { ascending: true }); // most-overdue-first
  const checkpoints = [
    ...(saved ?? []),
    ...unsaved.map((d) => ({ id: `${UNSAVED_CHECKPOINT}${d}`, days_before_deadline: d })),
  ].sort((a, b) => a.days_before_deadline - b.days_before_deadline);
  if (checkpoints.length === 0) return [];

  const deadline = new Date(checklist.deadline_at).getTime();
  const now = Date.now();
  const dueCheckpoints = checkpoints.filter(
    (cp) => deadline - cp.days_before_deadline * 24 * 60 * 60 * 1000 <= now
  );
  if (dueCheckpoints.length === 0) return [];

  const orgIds = await resolveScopedOrgs(db, checklist);
  if (orgIds.length === 0) return [];

  const { data: alreadyLogged } = await db
    .from("conference_checklist_reminder_log")
    .select("checkpoint_id, organization_id")
    .in(
      "checkpoint_id",
      dueCheckpoints.map((cp) => cp.id).filter((id) => !id.startsWith(UNSAVED_CHECKPOINT))
    );
  const loggedSet = new Set((alreadyLogged ?? []).map((r) => `${r.checkpoint_id}:${r.organization_id}`));

  const due: DueOrg[] = [];
  for (const orgId of orgIds) {
    // dueCheckpoints is sorted most-overdue-first; take the first unlogged one.
    const checkpoint = dueCheckpoints.find((cp) => !loggedSet.has(`${cp.id}:${orgId}`));
    if (checkpoint) due.push({ organizationId: orgId, checkpointId: checkpoint.id });
  }
  return due;
}

export interface ChecklistRunResult {
  checklistsProcessed: number;
  orgsReminded: number;
  errors: string[];
  /**
   * Who WOULD be written to, and about what. Present on a dry run only.
   *
   * Reminders are the one thing here that reaches people outside CSC, and
   * deriving the cadence means a checklist that has been silent for months can
   * start sending on the next tick. A run that cannot be inspected before it
   * goes is a run nobody can be accountable for.
   */
  preview?: Array<{ organizationId: string; organization: string; recipients: string[]; items: string[] }>;
}

/**
 * Evaluate every active checklist's due checkpoints and send digest
 * reminders to orgs with open tasks. Called identically from the admin
 * "Send Reminders Now" button and the daily cron route — same code path,
 * so what's tested manually is exactly what runs unattended.
 */
/**
 * Which of an organisation's outstanding items leads today's reminder.
 *
 * ⛔ NOT "whatever fired today", and ⛔ NOT the same item every time.
 *
 * Two failures, in order. First the subject was the task's own name, so five
 * consecutive sends said "Send your product for Conference in a Box". Giving
 * each task several phrasings fixed the repetition and not the problem: the
 * lead still came from whichever checklist triggered the send, and since the
 * Box owns most of the early checkpoints, every October subject was a
 * different way of saying Conference in a Box. The ED: "there are so many
 * things we need them to do and not all of them are about the conference in
 * a box."
 *
 * So:
 *  · something genuinely close (inside a week) leads, because it has earned
 *    the subject line and a reader who opens for it is opening in time;
 *  · otherwise the lead ROTATES across everything they still owe, so a month
 *    of reminders surfaces six different obligations rather than one.
 *
 * The whole list is in the body either way. This only decides what the
 * envelope says.
 */
const URGENT_WITHIN_DAYS = 7;

function pickLeadSection<T extends { triggered: boolean; daysOut: number; subjectLines: string[] }>(
  sections: T[],
  remindersSoFar: number
): T | undefined {
  if (sections.length === 0) return undefined;

  /*
    ⛔ OVERDUE NEVER LEADS.

    This filtered on `daysOut <= 7`, which is true of every negative number,
    and then sorted ascending — so the MOST overdue item was permanently the
    "nearest" and took every subject line thereafter. Simulated: an org that
    missed Conference in a Box on 20 November led all eight remaining
    reminders with it, 56 days past, still saying "Last call" and "closes
    soon" about a shipment the rules say is no longer accepted. Stronco,
    Encore, booth staff and payment — all still actionable, all with money
    attached — never reached the subject again.

    A missed cliff has no action left to ask for, so it loses its claim on
    the envelope. It stays in the body, where the renderer already labels it
    "Closed N days ago" rather than pretending.
  */
  const upcoming = sections.filter((x) => x.daysOut >= 0);
  const urgent = upcoming
    .filter((x) => x.daysOut <= URGENT_WITHIN_DAYS)
    .sort((a, b) => a.daysOut - b.daysOut);
  if (urgent.length > 0) return urgent[0];

  // Otherwise rotate across what can still be acted on.
  if (upcoming.length > 0) return upcoming[remindersSoFar % upcoming.length];

  // Everything they owe is already past. Still write, still rotate — the body
  // tells the truth about each one, and silence would be worse.
  return sections[remindersSoFar % sections.length];
}

function pickSubjectLine(pending: {
  conferenceYear: number;
  remindersSoFar: number;
  sections: { triggered: boolean; daysOut: number; subjectLines: string[] }[];
}): string {
  const lead = pickLeadSection(pending.sections, pending.remindersSoFar);
  const lines = lead?.subjectLines ?? [];
  if (lines.length === 0) return `Get ready for the ${pending.conferenceYear} conference`;
  // Rotate the phrasing too, so a repeat lead is not a repeat subject.
  return lines[pending.remindersSoFar % lines.length];
}

export async function runChecklistReminders(
  options: {
    dryRun?: boolean;
    /**
     * One conference's checklists only — the War Room's button (Stephen,
     * 2026-10-23). The cron omits it and runs them all. An email then carries
     * only that conference's outstanding lists as context.
     */
    conferenceId?: string;
  } = {}
): Promise<ChecklistRunResult> {
  const dryRun = options.dryRun === true;
  const db = createAdminClient();
  const result: ChecklistRunResult = { checklistsProcessed: 0, orgsReminded: 0, errors: [] };
  if (dryRun) result.preview = [];

  let checklistQuery = db
    .from("conference_checklists")
    .select("id, conference_id, name, deadline_at, scope_entity_id, scope_entity_kind, publication_id, publication:publications(title), conference:conference_instances(year, edition_code)")
    .eq("active", true);
  if (options.conferenceId) checklistQuery = checklistQuery.eq("conference_id", options.conferenceId);
  const { data: checklists, error: checklistsError } = await checklistQuery;
  if (checklistsError) {
    result.errors.push(`Failed to load checklists: ${checklistsError.message}`);
    return result;
  }

  /**
   * One email per organisation, not one per checklist.
   *
   * The old shape sent a separate digest for every checklist that happened to
   * be due, so a partner admin with three armed checklists received three
   * messages — each titled "a few things still need your attention", each
   * showing a slice of their list, each framed differently. From the
   * recipient's side that reads as three unrelated nags about the same
   * conference.
   *
   * The action centres already merge across checklists (`loadOrgTasks` /
   * `loadPersonalTasks`); this makes the mail agree with them.
   */
  type Pending = {
    conferenceId: string;
    conferenceYear: number;
    orgName: string;
    /** Each carries its OWN framing, so a lone reminder still reads specifically. */
    sections: {
      checklistId: string; checklistName: string; closesAt: string;
      openItemsHtml: string; introLine: string; itemNames: string[]; subjectLines: string[];
      /** Days until this list closes — decides whether it earns the subject. */
      daysOut: number;
      /** True when THIS list's checkpoint is what caused the send today. */
      triggered: boolean;
    }[];
    /** Only publication-scoped checklists contribute the consent note. */
    consentNote: string;
    /** "Your list is always at …" footer; the same for every section of one org. */
    whereToTrack: string;
    /** How many reminders this org has already had — rotates the subject. */
    remindersSoFar: number;
    log: { checklist_id: string; checkpoint_id: string; organization_id: string }[];
  };
  const pendingByOrg = new Map<string, Pending>();

  // Who is due, for every checklist at once: independent reads. The loop
  // below still applies them in order.
  const settled = await Promise.allSettled((checklists ?? []).map((checklist) => findDueOrgs(db, checklist, dryRun)));
  const dueByChecklist = new Map((checklists ?? []).map((checklist, i) => [checklist.id, settled[i]] as const));

  for (const checklist of checklists ?? []) {
    try {
      const conference = Array.isArray(checklist.conference) ? checklist.conference[0] : checklist.conference;
      if (!conference) continue;
      const publication = Array.isArray(checklist.publication) ? checklist.publication[0] : checklist.publication;
      const framing = renderFraming(
        { ...checklist, publicationTitle: publication?.title ?? null },
        conference.year
      );

      const due = dueByChecklist.get(checklist.id)!;
      if (due.status === "rejected") throw due.reason;
      const dueOrgs = due.value;
      result.checklistsProcessed++;
      if (dueOrgs.length === 0) continue;

      // Every due org's digest at once (independent reads), applied in order.
      const digests = await Promise.all(
        dueOrgs.map(({ organizationId }) =>
          buildChecklistDigest({ ...checklist, publicationTitle: publication?.title ?? null }, conference, organizationId, db)
        )
      );
      for (const [index, { organizationId, checkpointId }] of dueOrgs.entries()) {
        const digest = digests[index];
        /*
          ⛔ A FINISHED TRIGGER STILL OPENS THE DOOR.

          This used to `continue` when the triggering checklist had nothing
          open, which meant doing the thing early cancelled the whole email —
          including the five other obligations the same org still had. The
          org that acted heard less from us than the org that ignored us,
          which is the exact opposite of what a reminder series is for.

          The checkpoint decides WHEN we may write. Whether we write at all
          is decided at the end, by whether anything is actually outstanding
          anywhere (orgs with no sections are dropped before sending).
        */
        const existing: Pending = pendingByOrg.get(organizationId) ?? {
          conferenceId: checklist.conference_id,
          conferenceYear: conference.year,
          orgName: digest?.orgName ?? "",
          sections: [],
          consentNote: "",
          whereToTrack: "",
          remindersSoFar: 0,
          log: [],
        };
        if (digest) existing.sections.push({
          triggered: true,
          checklistId: checklist.id,
          closesAt: checklist.deadline_at,
          checklistName: checklist.name,
          openItemsHtml: digest.variables.open_items_html,
          introLine: framing.intro_line,
          // For the dry run: what this org is actually being asked, by name.
          itemNames: digest.openItems.map((i) => i.name),
          subjectLines: digest.openItems.flatMap((i) => i.subjectLines),
          daysOut: Math.ceil(
            (new Date(checklist.deadline_at).getTime() - Date.now()) / 86_400_000
          ),
        });
        // Carried once even if several checklists would supply it.
        if (digest && !existing.orgName) existing.orgName = digest.orgName;
        if (digest && !existing.whereToTrack) existing.whereToTrack = digest.variables.where_to_track;
        if (!existing.consentNote && framing.consent_note) existing.consentNote = framing.consent_note;
        existing.log.push({ checklist_id: checklist.id, checkpoint_id: checkpointId, organization_id: organizationId });
        pendingByOrg.set(organizationId, existing);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      result.errors.push(`Checklist ${checklist.id}: ${msg}`);
      console.error(`[checklist-engine] Failed for checklist ${checklist.id}:`, msg);
    }
  }

  if (pendingByOrg.size === 0) return result;

  /*
    ⛔ THE REMINDER IS THE WHOLE CHECKLIST, NOT THE BIT THAT FIRED TODAY.

    A section was only added for a checklist whose own checkpoint was due, so
    the first real send told sixteen Connected Exhibitors about Conference in
    a Box and nothing else — while the same orgs had a hotel to book, payment
    to settle, agreements to accept and booth staff to name, all open, none
    mentioned. Steve: "that isn't a reminder of the entire checklist... we're
    supposed to be adding in and removing sections for everything that they
    are supposed to be doing."

    So: the checkpoint decides WHEN to write to someone. What they get is
    everything they still owe.

    ⛔ Only the checklists that were actually DUE get logged. A section added
    for context must not consume its own checkpoint, or its real reminder
    never arrives.
  */
  const scopedByChecklist = new Map<string, Promise<string[]>>();
  for (const [organizationId, pending] of pendingByOrg) {
    const alreadyIn = new Set(pending.sections.map((x) => x.checklistId));
    // Every context digest for this org at once (they are independent reads),
    // then applied in checklist order so the email is the same as one built
    // one by one. One by one took two minutes for a single conference.
    const built = await Promise.all(
      (checklists ?? []).map(async (checklist) => {
        if (alreadyIn.has(checklist.id)) return null;
        const conference = Array.isArray(checklist.conference) ? checklist.conference[0] : checklist.conference;
        if (!conference) return null;
        try {
          // Once per checklist, not once per (org, checklist): who a list
          // covers does not depend on which org is asking.
          const scoped = await (scopedByChecklist.get(checklist.id) ??
            scopedByChecklist.set(checklist.id, resolveScopedOrgs(db, checklist)).get(checklist.id)!);
          if (!scoped.includes(organizationId)) return null;
          const publication = Array.isArray(checklist.publication) ? checklist.publication[0] : checklist.publication;
          const digest = await buildChecklistDigest(
            { ...checklist, publicationTitle: publication?.title ?? null },
            conference,
            organizationId,
            db
          );
          return { checklist, conference, publication, digest, error: null as string | null };
        } catch (err) {
          return { checklist, conference, publication: null, digest: null, error: err instanceof Error ? err.message : "Unknown error" };
        }
      })
    );
    for (const entry of built) {
      if (!entry) continue;
      const { checklist, conference, publication, digest } = entry;
      if (entry.error) {
        result.errors.push(`Context section ${checklist.id} for ${organizationId}: ${entry.error}`);
        continue;
      }
      if (!digest) continue; // nothing outstanding on that list — stays off
      // The org's name may still be blank if the checklist that triggered
      // this send had nothing open — that path never saw a digest.
      if (!pending.orgName) pending.orgName = digest.orgName;
      if (!pending.whereToTrack) pending.whereToTrack = digest.variables.where_to_track;
      const framing = renderFraming(
        { ...checklist, publicationTitle: publication?.title ?? null },
        conference.year
      );
      pending.sections.push({
        triggered: false,
        checklistId: checklist.id,
        closesAt: checklist.deadline_at,
        checklistName: checklist.name,
        openItemsHtml: digest.variables.open_items_html,
        introLine: framing.intro_line,
        itemNames: digest.openItems.map((i) => i.name),
        subjectLines: digest.openItems.flatMap((i) => i.subjectLines),
        daysOut: Math.ceil(
          (new Date(checklist.deadline_at).getTime() - Date.now()) / 86_400_000
        ),
      });
      if (!pending.consentNote && framing.consent_note) pending.consentNote = framing.consent_note;
    }
    /*
      What fired TODAY goes to the top, then the rest by nearest cliff.

      Every send carries the whole outstanding list, so without this the
      reason for today's email could sit fifth. The ED: "send the reminder
      with that action at the top and as the subject." The carried sections
      are context; the triggered one is the ask.
    */
    // Nothing outstanding anywhere: the checkpoint opened the door and there
    // was no reason to walk through it. Dropped before any recipient is
    // resolved, so a fully caught-up org is never written to.
    if (pending.sections.length === 0) { pendingByOrg.delete(organizationId); continue; }

    // Nearest cliff first — the order someone should work the list in. The
    // LEAD (see pickLeadSection) is hoisted above it once chosen, so the
    // thing named in the subject is the first thing in the body.
    pending.sections.sort((a, b) => a.closesAt.localeCompare(b.closesAt));
  }

  const recipients: { email: string; name: string | null; variableOverrides: Record<string, string> }[] = [];
  // Who, per organisation: the dry run's "who gets what", by id (two orgs can share a name).
  const emailsByOrg = new Map<string, string[]>();
  const sentLog: { checklist_id: string; checkpoint_id: string; organization_id: string }[] = [];
  let conferenceIdForAudience: string | null = null;

  for (const [organizationId, pending] of pendingByOrg) {
    // How many reminders this org has had for this conference, which is what
    // rotates the subject line. Counted once per org, not per section.
    const { count: priorReminders } = await db
      .from("conference_checklist_reminder_log")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId);
    pending.remindersSoFar = priorReminders ?? 0;

    const admins = await resolveAudience({
      type: "org_admins",
      filters: { org_ids: [organizationId] },
    } satisfies AudienceDefinition);
    if (admins.length === 0) continue;

    conferenceIdForAudience ??= pending.conferenceId;
    /*
      ⛔ ALWAYS A LIST, EVEN WHEN THERE IS ONE THING ON IT.

      This used to drop the section heading and title the whole email after
      the single checklist that happened to be due. That read correctly when
      checklists were broad ("Your Conference", "Exhibitor"), and stopped the
      day they were split one-per-deadline: the first real send went out
      titled "Conference in a Box", which lands as a one-off notice about a
      product rather than as the conference checklist it belongs to.

      Steve, seeing it: "they got Conference in a Box, not the reminder task
      list". One shape now, so a list of one still looks like a list.
    */
    // The subject's item goes first; everything else follows by nearest cliff.
    const lead = pickLeadSection(pending.sections, pending.remindersSoFar);
    const ordered = lead
      ? [lead, ...pending.sections.filter((x) => x !== lead)]
      : pending.sections;
    const body = ordered
      .map((s) => `<p style="margin:18px 0 4px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#6b7280">${s.checklistName}</p>\n${s.openItemsHtml}`)
      .join("\n");

    emailsByOrg.set(organizationId, admins.map((admin) => admin.email));
    for (const admin of admins) {
      recipients.push({
        email: admin.email,
        name: admin.name,
        variableOverrides: {
          // "there", never the address: a contact with no name used to be
          // greeted "Hi lsukyas@crestar.ca,".
          contact_name: admin.name?.trim() || "there",
          where_to_track: pending.whereToTrack,
          org_name: pending.orgName,
          // Always the conference, never whichever list fired. The specific
          // list is the section heading inside; the email is the checklist.
          checklist_name: `${pending.conferenceYear} conference checklist`,
          /*
            The subject names the ACTION that caused today's send.

            Every reminder carries the full outstanding list, so a subject
            built from the list itself ("2027 conference checklist") is the
            same words every time and stops being read by November. The thing
            that changes send to send is which item just hit its mark, and
            that is what belongs in the preview line.

            Falls back to the nearest cliff when a send is carried rather
            than triggered, so the subject is never empty.
          */
          headline_action: pickSubjectLine(pending),
          open_items_html: body,
          conference_year: String(pending.conferenceYear),
          // One checklist keeps its own specific framing. Several become a
          // NEUTRAL opening, because the sections may mix a conference
          // checklist with a directory one — asserting "for the conference"
          // over a member store's directory tasks is exactly the wrong-audience
          // wording this framing exists to avoid. Each section is headed by its
          // checklist name, so the specifics are not lost.
          intro_line:
            pending.sections.length === 1
              ? pending.sections[0].introLine
              : "has a few things outstanding:",
          // (framing stays per-section when there is exactly one, so a lone
          //  reminder still explains WHY it is being asked)
          consent_note: pending.consentNote,
        },
      });
    }
    sentLog.push(...pending.log);
  }

  /**
   * The off-switch, checked where the send happens rather than at the caller.
   * A suppressed run still computes everything and still reports it — what it
   * does not do is write to anyone, or log a send that would stop the real one
   * later.
   */
  if (checklistEmailSuppressed() && !dryRun) {
    result.errors.push(
      "CHECKLIST_SUPPRESS_EMAIL=1 — computed the run and sent nothing."
    );
    result.orgsReminded = 0;
    return result;
  }

  if (dryRun) {
    // Everything above this line is read-only: scope resolution, the checks,
    // the digest. Stopping here reports exactly what the real run would do
    // without a campaign, a send, or a log row that would suppress it later.
    // ⚠️ Only orgs with someone to write to: an org with no admin is skipped by
    // the real run too, and counting it would overstate the send.
    for (const [organizationId, pending] of pendingByOrg) {
      const emails = emailsByOrg.get(organizationId);
      if (!emails) continue;
      result.preview!.push({
        organizationId,
        organization: pending.orgName,
        recipients: emails,
        items: pending.sections.flatMap((sec) => sec.itemNames),
      });
    }
    result.orgsReminded = result.preview!.length;
    return result;
  }

  if (recipients.length === 0) return result;

  const campaignResult = await createCampaign({
    name: `Checklist reminders — ${pendingByOrg.size} organisation${pendingByOrg.size === 1 ? "" : "s"}`,
    templateKey: "conference_checklist_reminder",
    audience: {
      type: "custom_recipient_list",
      filters: { conference_instance_id: conferenceIdForAudience ?? undefined, recipients },
    },
    triggerSource: "conference",
    automationMode: "auto_send",
  });

  if (campaignResult.success && campaignResult.campaignId) {
    await executeCampaignSend(campaignResult.campaignId);
    if (sentLog.length > 0) {
      await db.from("conference_checklist_reminder_log").insert(sentLog);
    }
    result.orgsReminded += pendingByOrg.size;
  } else {
    result.errors.push(`Campaign creation failed — ${campaignResult.error}`);
  }

  return result;
}

/**
 * Run a single checklist task's completion check for one org — the same
 * CHECKS registry the reminder digest uses internally, exposed so other
 * callers (the comms condition system's "Checklist Task" subject) can ask
 * "is this org done with this task yet" without duplicating the check
 * logic or its fixed vocabulary.
 */
export { CHECK_TYPES, type CheckType };
export { evaluateChecklistTaskCheck };
