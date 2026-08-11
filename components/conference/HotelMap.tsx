"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

/**
 * Same static mini-map treatment as OrgLocation.tsx (light-v11, non-interactive,
 * pinned marker) for one visual language site-wide, rather than a Google Maps
 * iframe that looks like a different product. Prefers verified `lat`/`lng`
 * (conference_instances.location_latitude/longitude — the same source
 * MapHero's own conference pin uses) when given; only falls back to live-
 * geocoding the address text when coordinates aren't available. Text
 * geocoding is a best-effort fallback, not a source of truth — a hotel name
 * shared by multiple properties in the same city (e.g. more than one local
 * Hilton) can resolve to the wrong one. The whole map links out to Google
 * Maps for directions — it's a locator, not a navigation tool.
 */
export default function HotelMap({
  address,
  lat,
  lng,
}: {
  address: string;
  lat?: number | null;
  lng?: number | null;
}) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const hasVerifiedCoords = lat != null && lng != null;
  const [coords, setCoords] = useState<[number, number] | null>(
    hasVerifiedCoords ? [lng as number, lat as number] : null
  );
  const [mapLoaded, setMapLoaded] = useState(false);
  const [geocodeFailed, setGeocodeFailed] = useState(false);

  useEffect(() => {
    if (hasVerifiedCoords) {
      setCoords([lng as number, lat as number]);
      return;
    }
    let cancelled = false;
    fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?access_token=${mapboxgl.accessToken}&limit=1`
    )
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const center = data?.features?.[0]?.center;
        if (Array.isArray(center) && center.length === 2) {
          setCoords([center[0], center[1]]);
        } else {
          setGeocodeFailed(true);
        }
      })
      .catch(() => {
        if (!cancelled) setGeocodeFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [address, hasVerifiedCoords, lat, lng]);

  useEffect(() => {
    if (!mapContainer.current || !coords) return;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/light-v11",
      center: coords,
      zoom: 14,
      interactive: false,
    });
    map.current.on("load", () => setMapLoaded(true));

    const el = document.createElement("div");
    el.className = "w-8 h-8 rounded-full flex items-center justify-center";
    el.style.backgroundColor = "#EE2A2E";
    el.style.border = "3px solid white";
    el.style.boxShadow = "0 2px 8px rgba(0,0,0,0.3)";
    new mapboxgl.Marker(el).setLngLat(coords).addTo(map.current);

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, [coords]);

  const directionsUrl = coords
    ? `https://www.google.com/maps/dir/?api=1&destination=${coords[1]},${coords[0]}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

  return (
    <a
      href={directionsUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="relative block h-64 w-full overflow-hidden rounded-xl border border-[#E5E5E5] bg-slate-100"
      aria-label={`Open ${address} in Google Maps`}
    >
      <div ref={mapContainer} className="h-full w-full" />
      {!mapLoaded && !geocodeFailed && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-100">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#EE2A2E] border-t-transparent" />
        </div>
      )}
      {geocodeFailed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-slate-100 text-sm text-[#6B6B6B]">
          <span>Map unavailable</span>
          <span className="font-medium text-[#EE2A2E]">Open in Google Maps →</span>
        </div>
      )}
    </a>
  );
}
