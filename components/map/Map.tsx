"use client";

import {
  useEffect,
  useRef,
  useState,
  useImperativeHandle,
  forwardRef,
} from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Organization } from "@/lib/database.types";

// Set access token
mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

interface MapProps {
  organizations: Organization[];
  onOrganizationClick?: (org: Organization) => void;
  onOrganizationHover?: (org: Organization | null) => void;
  highlightedOrgId?: string | null;
}

// Expose these methods to parent components
export interface MapRef {
  flyTo: (coords: [number, number], zoom?: number) => void;
  resetView: () => void;
  getCoordinatesForOrg: (org: Organization) => [number, number] | null;
}

// Canada center coordinates
const CANADA_CENTER: [number, number] = [-106.3468, 56.1304];
const CANADA_ZOOM = 3.5;
const FOCUSED_ZOOM = 8;

const Map = forwardRef<MapRef, MapProps>(function Map(
  { organizations, onOrganizationClick, onOrganizationHover, highlightedOrgId },
  ref
) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<globalThis.Map<string, mapboxgl.Marker>>(new globalThis.Map());
  const [mapLoaded, setMapLoaded] = useState(false);

  // Expose map controls to parent
  useImperativeHandle(ref, () => ({
    flyTo: (coords: [number, number], zoom = FOCUSED_ZOOM) => {
      map.current?.flyTo({
        center: coords,
        zoom,
        duration: 2000,
        essential: true,
      });
    },
    resetView: () => {
      map.current?.flyTo({
        center: CANADA_CENTER,
        zoom: CANADA_ZOOM,
        duration: 1500,
        essential: true,
      });
    },
    getCoordinatesForOrg: (org: Organization) => getCoordinates(org),
  }));

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/light-v11",
      center: CANADA_CENTER,
      zoom: CANADA_ZOOM,
      minZoom: 2,
      maxZoom: 15,
      scrollZoom: false, // Disable scroll zoom by default - let page scroll work
    });

    map.current.on("load", () => {
      setMapLoaded(true);
    });

    // Enable scroll zoom only with Ctrl/Cmd key held
    const mapInstance = map.current;
    const container = mapContainer.current;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        mapInstance.scrollZoom.enable();
      } else {
        mapInstance.scrollZoom.disable();
      }
    };

    container.addEventListener("wheel", handleWheel, { passive: false });

    // Add navigation controls
    map.current.addControl(new mapboxgl.NavigationControl(), "top-right");

    return () => {
      container.removeEventListener("wheel", handleWheel);
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Add markers when map is loaded and organizations change
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    // Clear existing markers
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current.clear();

    // Add markers for each organization with coordinates
    organizations.forEach((org) => {
      // Use stored coordinates from database, fallback to city lookup
      const coords = getCoordinates(org);
      if (!coords) return;

      // Create custom marker element
      const el = document.createElement("div");
      el.className = "map-marker";
      el.dataset.orgId = org.id;
      el.innerHTML = `
        <div class="marker-inner w-10 h-10 rounded-full flex items-center justify-center cursor-pointer transition-all duration-300 ${
          org.type === "Member"
            ? "bg-[#D60001] border-2 border-white shadow-lg"
            : "bg-[#3B82F6] border-2 border-white shadow-lg"
        }">
          ${
            org.logo_url
              ? `<img src="${org.logo_url}" alt="${org.name}" class="w-6 h-6 rounded-full object-cover" />`
              : `<span class="text-white text-xs font-bold">${getInitials(org.name)}</span>`
          }
        </div>
      `;

      // Add click handler
      el.addEventListener("click", () => {
        onOrganizationClick?.(org);
      });

      // Add hover handlers
      el.addEventListener("mouseenter", () => {
        onOrganizationHover?.(org);
      });

      el.addEventListener("mouseleave", () => {
        onOrganizationHover?.(null);
      });

      const marker = new mapboxgl.Marker(el).setLngLat(coords).addTo(map.current!);

      markersRef.current.set(org.id, marker);
    });
  }, [organizations, mapLoaded, onOrganizationClick, onOrganizationHover]);

  // Update marker highlighting when highlightedOrgId changes
  useEffect(() => {
    markersRef.current.forEach((marker, orgId) => {
      const el = marker.getElement();
      const inner = el.querySelector(".marker-inner") as HTMLElement;
      if (!inner) return;

      if (orgId === highlightedOrgId) {
        // Highlight this marker
        inner.style.transform = "scale(1.4)";
        inner.style.boxShadow = "0 0 0 4px rgba(255,255,255,0.8), 0 4px 20px rgba(0,0,0,0.3)";
        inner.style.zIndex = "100";
        el.style.zIndex = "100";
      } else {
        // Reset marker
        inner.style.transform = "";
        inner.style.boxShadow = "";
        inner.style.zIndex = "";
        el.style.zIndex = "";
      }
    });
  }, [highlightedOrgId]);

  return (
    <div ref={mapContainer} className="w-full h-full relative group">
      {!mapLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 border-2 border-[#D60001] border-t-transparent rounded-full animate-spin" />
            <span className="text-[#6B6B6B]">Loading map...</span>
          </div>
        </div>
      )}
      {/* Scroll zoom hint - shows briefly on hover */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/70 text-white text-sm px-4 py-2 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none z-10">
        Use ⌘/Ctrl + scroll to zoom
      </div>
    </div>
  );
});

export default Map;

// Helper to get initials from org name
function getInitials(name: string): string {
  return name
    .split(" ")
    .map((word) => word[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

// Get coordinates - prefer stored lat/lng, fallback to city lookup
function getCoordinates(org: Organization): [number, number] | null {
  // First try stored coordinates from database
  if (org.latitude && org.longitude) {
    return [Number(org.longitude), Number(org.latitude)];
  }

  // Fallback to city lookup
  if (!org.city || !org.province) return null;

  const cityKey = `${org.city.toLowerCase()}, ${org.province.toLowerCase()}`;
  return CITY_COORDINATES[cityKey] || null;
}

// Fallback city coordinates for orgs without stored lat/lng
const CITY_COORDINATES: Record<string, [number, number]> = {
  // Alberta
  "calgary, alberta": [-114.0719, 51.0447],
  "edmonton, alberta": [-113.4909, 53.5461],
  "red deer, alberta": [-113.8116, 52.2681],
  "lethbridge, alberta": [-112.8328, 49.6956],
  "medicine hat, alberta": [-110.6764, 50.0405],

  // British Columbia
  "vancouver, british columbia": [-123.1216, 49.2827],
  "victoria, british columbia": [-123.3656, 48.4284],
  "burnaby, british columbia": [-122.9711, 49.2488],
  "surrey, british columbia": [-122.849, 49.1913],
  "kelowna, british columbia": [-119.4969, 49.888],
  "kamloops, british columbia": [-120.3273, 50.6745],
  "nanaimo, british columbia": [-123.9401, 49.1659],
  "terrace, british columbia": [-128.5986, 54.5182],
  "prince george, british columbia": [-122.7497, 53.9171],

  // Ontario
  "toronto, ontario": [-79.3832, 43.6532],
  "ottawa, ontario": [-75.6972, 45.4215],
  "hamilton, ontario": [-79.8711, 43.2557],
  "london, ontario": [-81.2497, 42.9849],
  "kitchener, ontario": [-80.4823, 43.4516],
  "windsor, ontario": [-83.0364, 42.3149],
  "oshawa, ontario": [-78.8658, 43.8971],
  "barrie, ontario": [-79.6903, 44.3894],
  "kingston, ontario": [-76.4813, 44.2312],
  "guelph, ontario": [-80.2482, 43.5448],
  "thunder bay, ontario": [-89.2477, 48.3809],
  "sudbury, ontario": [-81.0112, 46.49],
  "peterborough, ontario": [-78.3197, 44.3091],
  "sault ste. marie, ontario": [-84.3333, 46.5333],
  "north bay, ontario": [-79.4608, 46.3091],
  "st. catharines, ontario": [-79.2468, 43.1594],
  "oakville, ontario": [-79.6877, 43.4675],
  "scarborough, ontario": [-79.2506, 43.7731],
  "thornhill, ontario": [-79.4225, 43.8156],
  "vaughan, ontario": [-79.5, 43.8333],
  "brampton, ontario": [-79.7624, 43.7315],
  "mississauga, ontario": [-79.6441, 43.589],

  // Quebec
  "montreal, quebec": [-73.5673, 45.5017],
  "quebec city, quebec": [-71.2082, 46.8139],
  "laval, quebec": [-73.692, 45.6066],
  "sherbrooke, quebec": [-71.8929, 45.4042],
  "trois-rivières, quebec": [-72.5428, 46.3432],
  "chicoutimi, quebec": [-71.0689, 48.4279],

  // Manitoba
  "winnipeg, manitoba": [-97.1384, 49.8951],
  "brandon, manitoba": [-99.9539, 49.8485],

  // Saskatchewan
  "saskatoon, saskatchewan": [-106.67, 52.1332],
  "regina, saskatchewan": [-104.6189, 50.4452],

  // Nova Scotia
  "halifax, nova scotia": [-63.5752, 44.6488],
  "antigonish, nova scotia": [-61.9939, 45.6167],
  "sydney, nova scotia": [-60.1831, 46.1351],
  "wolfville, nova scotia": [-64.3644, 45.0913],

  // New Brunswick
  "fredericton, new brunswick": [-66.6431, 45.9636],
  "saint john, new brunswick": [-66.0633, 45.2733],
  "moncton, new brunswick": [-64.7782, 46.0878],

  // Newfoundland and Labrador
  "st. john's, newfoundland and labrador": [-52.7126, 47.5615],
  "corner brook, newfoundland and labrador": [-57.9521, 48.9489],

  // Prince Edward Island
  "charlottetown, prince edward island": [-63.1311, 46.2382],

  // Yukon
  "whitehorse, yukon": [-135.0568, 60.7212],

  // Northwest Territories
  "yellowknife, northwest territories": [-114.3718, 62.454],

  // Nunavut
  "iqaluit, nunavut": [-68.5167, 63.7467],
};
