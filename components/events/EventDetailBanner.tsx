// Server component — no "use client" needed

interface EventDetailBannerProps {
  startsAt: string;
  primaryColor: string;   // hex with #
  lat: number;
  lng: number;
  zoom?: number;
  creatorDisplayName: string | null;
  orgName: string;
  /** true = CSC-hosted: light map, white wash, brand colours */
  isCSC?: boolean;
}

function bannerMapUrl(
  lat: number,
  lng: number,
  zoom: number,
  token: string,
  style = "mapbox/light-v11"
): string {
  // Wide banner — 1200×400 retina (doubles to 2400×800, capped by Mapbox at useful size)
  return `https://api.mapbox.com/styles/v1/${style}/static/${lng},${lat},${zoom},0/1200x400@2x?access_token=${encodeURIComponent(token)}`;
}

export default function EventDetailBanner({
  startsAt,
  primaryColor,
  lat,
  lng,
  zoom = 8,
  creatorDisplayName,
  orgName,
  isCSC = false,
}: EventDetailBannerProps) {
  // Supabase returns "YYYY-MM-DD HH:mm:ss" without timezone — force UTC
  const utcStr = startsAt.endsWith("Z") || startsAt.includes("+") ? startsAt : startsAt.replace(" ", "T") + "Z";
  const date  = new Date(utcStr);
  const month = date.toLocaleString("en-CA", { month: "short", timeZone: "UTC" }).toUpperCase();
  const day   = String(date.getUTCDate()).padStart(2, "0");

  const token  = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const mapUrl = token ? bannerMapUrl(lat, lng, zoom, token) : null;

  return (
    <div className="relative w-full h-44 sm:h-52 rounded-2xl overflow-hidden mb-8 shadow-sm">
      {/* Map background */}
      {mapUrl ? (
        <img
          src={mapUrl}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 bg-gray-200" />
      )}

      {/* Colour overlay */}
      {isCSC ? (
        // Light wash for CSC — keeps map visible, brand feel
        <div className="absolute inset-0 bg-white/35" />
      ) : (
        // Brand colour multiply tint for member orgs
        <div
          className="absolute inset-0"
          style={{
            backgroundColor: primaryColor,
            opacity: 0.55,
            mixBlendMode: "multiply",
          }}
        />
      )}

      {/* Bottom gradient scrim so org name text reads cleanly */}
      <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/25 to-transparent" />

      {/* Date tile — top-left */}
      <div className="absolute top-4 left-4">
        <div
          className="relative rounded-xl overflow-hidden shadow-md"
          style={{ width: 72, height: 72 }}
        >
          {/* Tile background */}
          {isCSC ? (
            <>
              {mapUrl && (
                <img
                  src={mapUrl}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover"
                />
              )}
              <div className="absolute inset-0 bg-white/75" />
            </>
          ) : (
            <>
              {mapUrl && (
                <img
                  src={mapUrl}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover"
                />
              )}
              <div
                className="absolute inset-0"
                style={{
                  backgroundColor: primaryColor,
                  opacity: 0.7,
                  mixBlendMode: "multiply",
                }}
              />
            </>
          )}
          {/* Date text */}
          <div className="absolute inset-0 flex flex-col items-center justify-center select-none">
            <span
              className="font-black uppercase tracking-widest leading-none"
              style={{ fontSize: 9, color: isCSC ? "#EE2A2E" : "rgba(255,255,255,0.85)" }}
            >
              {month}
            </span>
            <span
              className="font-black leading-none mt-0.5"
              style={{ fontSize: 26, color: isCSC ? "#163D6D" : "#ffffff" }}
            >
              {day}
            </span>
          </div>
        </div>
      </div>

      {/* Host attribution — bottom-left */}
      <div className="absolute bottom-3 left-4">
        <span className="text-xs font-semibold text-white/90 drop-shadow-sm">
          Hosted by{" "}
          {creatorDisplayName ? `${creatorDisplayName} — ${orgName}` : orgName}
        </span>
      </div>
    </div>
  );
}
