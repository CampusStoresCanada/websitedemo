// Server component — no "use client" needed

interface EventDateTileProps {
  startsAt: string;
  primaryColor: string;   // hex with #
  lat: number;
  lng: number;
  zoom?: number;
  /** px size of the square tile */
  size?: number;
  /** true = CSC-hosted: light map, no tint, brand red month, navy day */
  isCSC?: boolean;
}

function mapboxUrl(
  lat: number,
  lng: number,
  zoom: number,
  sizePx: number,
  token: string,
  style = "mapbox/light-v11"
): string {
  const dim = Math.min(1280, sizePx * 2);
  return `https://api.mapbox.com/styles/v1/${style}/static/${lng},${lat},${zoom},0/${dim}x${dim}@2x?access_token=${encodeURIComponent(token)}`;
}

export default function EventDateTile({
  startsAt,
  primaryColor,
  lat,
  lng,
  zoom = 8,
  size = 96,
  isCSC = false,
}: EventDateTileProps) {
  // Supabase returns "YYYY-MM-DD HH:mm:ss" without timezone — force UTC
  const utcStr = startsAt.endsWith("Z") || startsAt.includes("+") ? startsAt : startsAt.replace(" ", "T") + "Z";
  const date  = new Date(utcStr);
  const month = date.toLocaleString("en-CA", { month: "short", timeZone: "UTC" }).toUpperCase();
  const day   = String(date.getUTCDate()).padStart(2, "0");

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const bgUrl = token ? mapboxUrl(lat, lng, zoom, size, token) : null;

  if (isCSC) {
    // Light map, no colour overlay — brand red month, navy day
    return (
      <div
        className="relative rounded-xl overflow-hidden shrink-0 shadow-sm border border-gray-100"
        style={{ width: size, height: size }}
      >
        {bgUrl ? (
          <img
            src={bgUrl}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 bg-gray-100" />
        )}
        {/* Very subtle white wash so text pops on light map */}
        <div className="absolute inset-0 bg-white/40" />
        <div className="absolute inset-0 flex flex-col items-center justify-center select-none">
          <span
            className="font-black uppercase tracking-widest leading-none"
            style={{ fontSize: size * 0.13, color: "#EE2A2E" }}
          >
            {month}
          </span>
          <span
            className="font-black leading-none mt-0.5"
            style={{ fontSize: size * 0.35, color: "#163D6D" }}
          >
            {day}
          </span>
        </div>
      </div>
    );
  }

  // Org event — colour tint overlay, white text
  return (
    <div
      className="relative rounded-xl overflow-hidden shrink-0 shadow-sm"
      style={{ width: size, height: size }}
    >
      {bgUrl ? (
        <img
          src={bgUrl}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 bg-gray-300" />
      )}
      {/* Colour tint — same mix-blend-mode: multiply as conference badges */}
      <div
        className="absolute inset-0"
        style={{
          backgroundColor: primaryColor,
          opacity: 0.55,
          mixBlendMode: "multiply",
        }}
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center select-none">
        <span
          className="font-black uppercase tracking-widest leading-none"
          style={{ fontSize: size * 0.13, color: "rgba(255,255,255,0.85)" }}
        >
          {month}
        </span>
        <span
          className="font-black leading-none mt-0.5"
          style={{ fontSize: size * 0.35, color: "#ffffff" }}
        >
          {day}
        </span>
      </div>
    </div>
  );
}
