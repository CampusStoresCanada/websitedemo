"use client";

import { useState } from "react";
import React from "react";

interface ShowMoreListProps {
  children: React.ReactNode;
  initialCount?: number;
  className?: string;
}

export default function ShowMoreList({
  children,
  initialCount = 5,
  className = "space-y-3",
}: ShowMoreListProps) {
  const [showAll, setShowAll] = useState(false);

  const items = React.Children.toArray(children);
  const visible = showAll ? items : items.slice(0, initialCount);
  const remaining = items.length - initialCount;

  return (
    <>
      <div className={className}>{visible}</div>
      {!showAll && remaining > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-3 text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          Show {remaining} more
        </button>
      )}
    </>
  );
}
