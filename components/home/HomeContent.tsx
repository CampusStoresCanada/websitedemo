"use client";

import { useEffect, useState } from "react";

/**
 * Wraps the non-map homepage content. Fades out when the map enters
 * explore mode (listening for the `mapExploreMode` custom event).
 */
export default function HomeContent({ children }: { children: React.ReactNode }) {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      const active = (e as CustomEvent).detail?.active;
      setHidden(!!active);
    };
    window.addEventListener("mapExploreMode", handler);
    return () => window.removeEventListener("mapExploreMode", handler);
  }, []);

  return (
    <div
      className={[
        "transition-[opacity,transform] duration-700 ease-in-out origin-top",
        hidden
          ? "opacity-0 pointer-events-none translate-y-8 max-h-0 overflow-hidden"
          : "opacity-100 translate-y-0",
      ].join(" ")}
      aria-hidden={hidden}
    >
      {children}
    </div>
  );
}
