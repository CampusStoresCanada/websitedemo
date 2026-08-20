import { createAdminClient } from "@/lib/supabase/admin";
import {
  sortActionItems,
  DEFAULT_SORT_POLICY,
  type SortableItem,
  type ScoredItem,
  type SortPolicy,
} from "@/lib/board/action-sort";

/**
 * Data for the board action-item checklist widget.
 * See docs/BOARD_ACTION_ITEM_MINT.md §11.
 */

export interface ChecklistRow {
  id: string;
  title: string;
  description: string | null;
  status: SortableItem["status"];
  priority: SortableItem["priority"];
  dueDate: string | null;
  dueDateLabel: string;
  startedAt: string | null;
  heldAt: string | null;
  raisedOn: string;
  assignees: string[];
  assigneeNames: string[];
  qualityFlags: string[];
  /** 0..1 — how much runway is gone. The bar draws this. */
  runway: number;
  daysOpen: number;
  tier: ScoredItem["tier"];
  escalated: boolean;
  updateCount: number;
  recurrence: string | null;
}

export interface ChecklistStats {
  byAssignment: { label: string; raised: number; completed: number; pct: number }[];
  perMeeting: { meetingDate: string; actions: number; intentions: number; cleared: number }[];
  ageBands: { band: string; count: number }[];
  escalatedCount: number;
  oldestOpenDays: number;
}

export interface BoardChecklistData {
  rows: ChecklistRow[];
  directory: { id: string; displayName: string }[];
  meetingDates: string[];
  upcomingMeetings: string[];
  stats: ChecklistStats;
  viewerId: string | null;
}

/** Standing work never gets a date, so its due column says so rather than "Open". */
function isStandingWork(flags: string[], title: string): boolean {
  if (!flags.includes("no_finish_line")) return false;
  return /\b(consistently|regularly|ongoing|on an ongoing basis)\b/i.test(title);
}

export async function getBoardChecklist(viewerId: string | null): Promise<BoardChecklistData> {
  const db = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);

  const [itemsRes, meetingsRes, profilesRes, updatesRes] = await Promise.all([
    db
      .from("board_action_items")
      .select(
        "id, title, description, status, priority, due_date, started_at, held_at, assignees, quality_flags, meeting_id, recurrence"
      ),
    db.from("board_meetings").select("id, meeting_date").neq("status", "cancelled").order("meeting_date"),
    db.from("profiles").select("id, display_name").in("global_role", ["admin", "super_admin"]).order("display_name"),
    db.from("board_action_item_updates").select("item_id"),
  ]);

  const meetings = meetingsRes.data ?? [];
  const meetingDateById = new Map(meetings.map((m) => [m.id, m.meeting_date]));
  const meetingDates = meetings.map((m) => m.meeting_date);
  const upcomingMeetings = meetingDates.filter((d) => d >= today);

  const directory = (profilesRes.data ?? [])
    .filter((p) => p.display_name)
    .map((p) => ({ id: p.id, displayName: p.display_name as string }));
  const nameById = new Map(directory.map((d) => [d.id, d.displayName]));

  const updateCounts = new Map<string, number>();
  for (const u of updatesRes.data ?? []) {
    updateCounts.set(u.item_id, (updateCounts.get(u.item_id) ?? 0) + 1);
  }

  const raw = itemsRes.data ?? [];

  const sortable: SortableItem[] = raw.map((r) => ({
    id: r.id,
    status: r.status as SortableItem["status"],
    priority: (r.priority ?? null) as SortableItem["priority"],
    dueDate: r.due_date,
    startedAt: r.started_at,
    heldAt: r.held_at,
    raisedOn: meetingDateById.get(r.meeting_id) ?? today,
    assigneeCount: (r.assignees ?? []).length,
    titleLength: (r.title ?? "").length,
    qualityFlagCount: (r.quality_flags ?? []).length,
  }));

  const policy: SortPolicy = DEFAULT_SORT_POLICY;
  const scored = sortActionItems(
    sortable.filter((s) => s.status !== "complete"),
    today,
    meetingDates,
    policy
  );

  const byId = new Map(raw.map((r) => [r.id, r]));

  const rows: ChecklistRow[] = scored.map((s) => {
    const r = byId.get(s.item.id)!;
    const assignees = (r.assignees ?? []) as string[];
    const flags = (r.quality_flags ?? []) as string[];
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      status: s.item.status,
      priority: s.item.priority,
      dueDate: r.due_date,
      dueDateLabel: r.due_date ?? (isStandingWork(flags, r.title) ? "Ongoing" : "Open"),
      startedAt: r.started_at,
      heldAt: r.held_at,
      raisedOn: s.item.raisedOn,
      assignees,
      assigneeNames: assignees.map((a) => nameById.get(a) ?? "Unknown"),
      qualityFlags: flags,
      runway: s.runway,
      daysOpen: s.daysOpen,
      tier: s.tier,
      escalated: s.escalated,
      updateCount: updateCounts.get(r.id) ?? 0,
      recurrence: r.recurrence ?? null,
    };
  });

  // ── Stats ───────────────────────────────────────────────────────────
  // Every figure here is arithmetic over the board's own record. That is
  // what makes it usable in a room — nobody has to accept an opinion.
  const named = raw.filter((r) => (r.assignees ?? []).length > 0 && r.status !== "intention");
  const unnamed = raw.filter((r) => (r.assignees ?? []).length === 0 || r.status === "intention");

  const rate = (set: typeof raw) => {
    const completed = set.filter((r) => r.status === "complete").length;
    return {
      raised: set.length,
      completed,
      pct: set.length ? Math.round((completed / set.length) * 1000) / 10 : 0,
    };
  };

  const perMeetingMap = new Map<string, { actions: number; intentions: number; cleared: number }>();
  for (const r of raw) {
    const date = meetingDateById.get(r.meeting_id);
    if (!date) continue;
    const entry = perMeetingMap.get(date) ?? { actions: 0, intentions: 0, cleared: 0 };
    if (r.status === "intention") entry.intentions += 1;
    else entry.actions += 1;
    if (r.status === "complete") entry.cleared += 1;
    perMeetingMap.set(date, entry);
  }

  const openRows = rows.filter((r) => r.status !== "intention");
  const bands = [
    { band: "Under 30 days", test: (d: number) => d < 30 },
    { band: "30–89 days", test: (d: number) => d >= 30 && d < 90 },
    { band: "90+ days", test: (d: number) => d >= 90 },
  ];

  return {
    rows,
    directory,
    meetingDates,
    upcomingMeetings,
    viewerId,
    stats: {
      byAssignment: [
        { label: "Named owner", ...rate(named) },
        { label: "No named owner", ...rate(unnamed) },
      ],
      perMeeting: Array.from(perMeetingMap.entries())
        .map(([meetingDate, v]) => ({ meetingDate, ...v }))
        .sort((a, b) => a.meetingDate.localeCompare(b.meetingDate)),
      ageBands: bands.map((b) => ({
        band: b.band,
        count: openRows.filter((r) => b.test(r.daysOpen)).length,
      })),
      escalatedCount: rows.filter((r) => r.escalated).length,
      oldestOpenDays: openRows.reduce((max, r) => Math.max(max, r.daysOpen), 0),
    },
  };
}
