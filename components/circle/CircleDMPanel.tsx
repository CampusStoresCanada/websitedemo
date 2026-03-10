"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/components/providers/AuthProvider";

interface ChatRoom {
  uuid: string;
  chat_room_kind: "direct" | "group_chat";
  last_message_at: string | null;
  members: Array<{ id: number; name: string; avatar_url: string | null }>;
}

interface ChatMessage {
  id: number;
  body: string;
  user_id: number;
  chat_room_uuid: string;
  created_at: string;
  user: { id: number; name: string; avatar_url: string | null } | null;
}

/**
 * Slide-out DM panel — shows conversations and allows replies.
 * All Circle API calls go through the server-side proxy at /api/circle/dm.
 */
export function CircleDMPanel({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const [chatRooms, setChatRooms] = useState<ChatRoom[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch chat rooms when panel opens
  useEffect(() => {
    if (!isOpen || !user) return;
    fetchChatRooms();
  }, [isOpen, user]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch messages when a room is selected
  useEffect(() => {
    if (!selectedRoom) return;
    fetchMessages(selectedRoom);
  }, [selectedRoom]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const fetchChatRooms = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/circle/dm");
      if (!res.ok) throw new Error("Failed to fetch conversations");
      const data = await res.json();
      setChatRooms(data.chatRooms ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchMessages = useCallback(async (roomUuid: string) => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/circle/dm?room=${roomUuid}`);
      if (!res.ok) throw new Error("Failed to fetch messages");
      const data = await res.json();
      setMessages(data.messages ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load messages");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleSend = useCallback(async () => {
    if (!selectedRoom || !newMessage.trim()) return;

    setIsSending(true);
    try {
      const res = await fetch("/api/circle/dm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatRoomUuid: selectedRoom,
          message: newMessage.trim(),
        }),
      });

      if (!res.ok) throw new Error("Failed to send");

      const data = await res.json();
      setMessages((prev) => [...prev, data.message]);
      setNewMessage("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setIsSending(false);
    }
  }, [selectedRoom, newMessage]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-full max-w-md bg-white shadow-2xl z-50 flex flex-col border-l border-gray-200">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center gap-2">
          {selectedRoom && (
            <button
              onClick={() => {
                setSelectedRoom(null);
                setMessages([]);
              }}
              className="text-gray-500 hover:text-gray-700"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>
          )}
          <h2 className="font-semibold text-gray-900">
            {selectedRoom ? "Conversation" : "Messages"}
          </h2>
        </div>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-gray-700"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-2 bg-red-50 text-red-700 text-sm">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-2 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
          </div>
        )}

        {!isLoading && !selectedRoom && (
          /* Chat room list */
          <div className="divide-y divide-gray-100">
            {chatRooms.length === 0 && (
              <p className="text-center text-gray-500 py-8 text-sm">
                No conversations yet
              </p>
            )}
            {chatRooms.map((room) => {
              const otherMembers = room.members.filter(
                (m) => m.name !== user?.email
              );
              const displayName =
                otherMembers.map((m) => m.name).join(", ") || "Conversation";

              return (
                <button
                  key={room.uuid}
                  onClick={() => setSelectedRoom(room.uuid)}
                  className="w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center text-purple-700 text-sm font-medium">
                      {displayName.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {displayName}
                      </p>
                      {room.last_message_at && (
                        <p className="text-xs text-gray-500">
                          {new Date(room.last_message_at).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {!isLoading && selectedRoom && (
          /* Message thread */
          <div className="px-4 py-3 space-y-3">
            {messages.map((msg) => (
              <div key={msg.id} className="flex gap-2">
                <div className="w-7 h-7 bg-gray-200 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-medium text-gray-600">
                  {msg.user?.name?.charAt(0).toUpperCase() ?? "?"}
                </div>
                <div className="flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium text-gray-900">
                      {msg.user?.name ?? "Unknown"}
                    </span>
                    <span className="text-xs text-gray-400">
                      {new Date(msg.created_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <p className="text-sm text-gray-700 mt-0.5">{msg.body}</p>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Reply input */}
      {selectedRoom && (
        <div className="border-t border-gray-200 p-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Type a message..."
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              disabled={isSending}
            />
            <button
              onClick={handleSend}
              disabled={isSending || !newMessage.trim()}
              className="px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSending ? "..." : "Send"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export { CircleDMPanel as default };
