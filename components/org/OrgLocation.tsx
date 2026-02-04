"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Organization } from "@/lib/database.types";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

interface OrgLocationProps {
  organization: Organization;
}

export default function OrgLocation({ organization }: OrgLocationProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  const hasCoordinates = organization.latitude && organization.longitude;
  const coords: [number, number] | null = hasCoordinates
    ? [Number(organization.longitude), Number(organization.latitude)]
    : null;

  useEffect(() => {
    if (!mapContainer.current || !coords) return;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/light-v11",
      center: coords,
      zoom: 13,
      interactive: false, // Static mini-map
    });

    map.current.on("load", () => {
      setMapLoaded(true);
    });

    // Add marker
    const el = document.createElement("div");
    el.className = "w-8 h-8 rounded-full flex items-center justify-center";
    el.style.backgroundColor = organization.type === "Member" ? "#D60001" : "#3B82F6";
    el.style.border = "3px solid white";
    el.style.boxShadow = "0 2px 8px rgba(0,0,0,0.3)";

    new mapboxgl.Marker(el).setLngLat(coords).addTo(map.current);

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, [coords, organization.type]);

  // Format full address
  const addressParts = [
    organization.street_address,
    organization.city,
    organization.province,
    organization.postal_code,
  ].filter(Boolean);

  const fullAddress = addressParts.join(", ");

  // Google Maps directions URL
  const directionsUrl = coords
    ? `https://www.google.com/maps/dir/?api=1&destination=${coords[1]},${coords[0]}`
    : fullAddress
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`
    : null;

  return (
    <div className="bg-slate-50 rounded-2xl overflow-hidden">
      {/* Mini Map */}
      {coords && (
        <div className="h-48 relative">
          <div ref={mapContainer} className="w-full h-full" />
          {!mapLoaded && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-100">
              <div className="w-5 h-5 border-2 border-[#D60001] border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>
      )}

      {/* Address Info */}
      <div className="p-6">
        <h3 className="font-semibold text-[#1A1A1A] mb-3">Location</h3>

        <div className="space-y-2 text-[#6B6B6B]">
          {organization.street_address && (
            <p>{organization.street_address}</p>
          )}
          <p>
            {organization.city && <span>{organization.city}</span>}
            {organization.city && organization.province && <span>, </span>}
            {organization.province && <span>{organization.province}</span>}
          </p>
          {organization.postal_code && (
            <p>{organization.postal_code}</p>
          )}
        </div>

        {directionsUrl && (
          <a
            href={directionsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-2 text-[#D60001] font-medium hover:underline"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Get directions
          </a>
        )}
      </div>
    </div>
  );
}
