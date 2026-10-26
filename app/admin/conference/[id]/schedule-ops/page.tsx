import { redirect } from "next/navigation";

/**
 * Schedule Ops is gone: generating, publishing, emailing and the live grid are
 * the War Room's Meetings tab (WAR_ROOM_OPERATE_PLAN §6). The address stays so
 * a bookmark lands there.
 */
export default async function ScheduleOpsMovedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/admin/conference/${id}/war-room?tab=meetings`);
}
