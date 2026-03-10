"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/components/providers/AuthProvider";

const POLL_INTERVAL_MS = 60_000; // 60 seconds
const LAST_SEEN_KEY = "circle_dm_last_seen";

/**
 * Unread DM badge — polls /api/circle/dm?summary=true for chat rooms
 * and compares the latest message timestamp against localStorage.
 *
 * Renders nothing if user is not authenticated or no unread messages.
 * Designed to be placed in the header (Chunk 16 integration).
 */
export function CircleDMBadge() {
  const { user } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkUnread = useCallback(async () => {
    if (!user) return;

    try {
      const res = await fetch("/api/circle/dm?summary=true");
      if (!res.ok) return;

      const data = await res.json();
      if (!data.linked || !data.chatRooms) return;

      const lastSeen = localStorage.getItem(LAST_SEEN_KEY);
      const lastSeenTime = lastSeen ? new Date(lastSeen).getTime() : 0;

      // Count rooms with messages newer than last seen
      let count = 0;
      for (const room of data.chatRooms) {
        if (room.last_message_at) {
          const msgTime = new Date(room.last_message_at).getTime();
          if (msgTime > lastSeenTime) {
            count++;
          }
        }
      }

      setUnreadCount(count);
    } catch {
      // Silently ignore errors
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;

    // Initial check
    checkUnread();

    // Poll
    intervalRef.current = setInterval(checkUnread, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [user, checkUnread]);

  /**
   * Mark messages as seen — call this when the DM panel opens.
   */
  const markAsSeen = useCallback(() => {
    localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString());
    setUnreadCount(0);
  }, []);

  if (!user || unreadCount === 0) return null;

  return (
    <button
      onClick={markAsSeen}
      className="relative inline-flex items-center justify-center"
      title={`${unreadCount} unread message${unreadCount !== 1 ? "s" : ""}`}
    >
      <span className="inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-red-500 rounded-full">
        {unreadCount > 9 ? "9+" : unreadCount}
      </span>
    </button>
  );
}

export { CircleDMBadge as default };
