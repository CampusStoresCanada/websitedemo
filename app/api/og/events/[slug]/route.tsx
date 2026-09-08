import { ImageResponse } from "next/og";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const adminClient = createAdminClient();

  // Fetch event
  const { data: event } = await adminClient
    .from("events")
    .select("id, title, description, starts_at, is_virtual, location, created_by, audience_mode")
    .eq("slug", slug)
    .eq("status", "published")
    .single();

  if (!event) {
    return new Response("Not found", { status: 404 });
  }

  // Resolve org context
  let orgName  = "Campus Stores Canada";
  let orgColor = "#163D6D";
  let lat      = 56;
  let lng      = -95;
  let zoom     = 3;

  if (event.created_by) {
    const { data: membership } = await adminClient
      .from("user_organizations")
      .select("organization_id")
      .eq("user_id", event.created_by)
      .order("created_at", { ascending: true })
      .limit(1)
      .single();

    if (membership?.organization_id) {
      const orgId = membership.organization_id;
      const [orgRes, colorRes] = await Promise.all([
        adminClient.from("organizations").select("name, latitude, longitude").eq("id", orgId).single(),
        adminClient.from("brand_colors").select("hex").eq("organization_id", orgId).order("sort_order", { ascending: true }).limit(1).single(),
      ]);
      if (orgRes.data) {
        orgName = orgRes.data.name ?? orgName;
        lat     = Number(orgRes.data.latitude ?? 56);
        lng     = Number(orgRes.data.longitude ?? -95);
        zoom    = orgRes.data.latitude != null ? 8 : 3;
      }
      if (colorRes.data?.hex) {
        const h = colorRes.data.hex;
        orgColor = h.startsWith("#") ? h : `#${h}`;
      }
    }
  }

  const isCSC = orgName === "Campus Stores Canada";

  // Mapbox background
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const mapUrl = token
    ? `https://api.mapbox.com/styles/v1/mapbox/light-v11/static/${lng},${lat},${zoom},0/1200x630@2x?access_token=${token}`
    : null;

  // Format date
  const startsAt = event.starts_at as string;
  const dateStr = new Intl.DateTimeFormat("en-CA", {
    weekday: "long",
    month:   "long",
    day:     "numeric",
    year:    "numeric",
    hour:    "numeric",
    minute:  "2-digit",
    timeZoneName: "short",
  }).format(new Date(startsAt));

  // Month / day for tile — use UTC to match stored timezone
  const month = new Intl.DateTimeFormat("en-CA", { month: "short", timeZone: "UTC" }).format(new Date(startsAt)).toUpperCase();
  const day   = String(new Date(startsAt).getUTCDate()).padStart(2, "0");

  // Fetch map image as data URL (ImageResponse can't fetch external images directly in all envs)
  let mapDataUrl: string | null = null;
  if (mapUrl) {
    try {
      const res = await fetch(mapUrl);
      if (res.ok) {
        const buf = await res.arrayBuffer();
        mapDataUrl = `data:image/png;base64,${Buffer.from(buf).toString("base64")}`;
      }
    } catch {
      // fall through to solid colour
    }
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          display: "flex",
          position: "relative",
          fontFamily: "sans-serif",
          overflow: "hidden",
        }}
      >
        {/* Map background */}
        {mapDataUrl ? (
          <img
            src={mapDataUrl}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <div style={{ position: "absolute", inset: 0, background: "#e5e7eb" }} />
        )}

        {/* Colour tint overlay */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: orgColor,
            opacity: 0.55,
          }}
        />

        {/* Dark scrim at bottom for text legibility */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: 280,
            background: "linear-gradient(to top, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0) 100%)",
          }}
        />

        {/* Date tile — top left */}
        <div
          style={{
            position: "absolute",
            top: 48,
            left: 56,
            width: 110,
            height: 110,
            borderRadius: 16,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(255,255,255,0.15)",
            backdropFilter: "blur(4px)",
            border: "1px solid rgba(255,255,255,0.3)",
          }}
        >
          <span style={{ fontSize: 16, fontWeight: 900, color: isCSC ? "#EE2A2E" : "rgba(255,255,255,0.85)", letterSpacing: 3, lineHeight: 1 }}>
            {month}
          </span>
          <span style={{ fontSize: 48, fontWeight: 900, color: "#ffffff", lineHeight: 1, marginTop: 2 }}>
            {day}
          </span>
        </div>

        {/* Bottom content */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            padding: "0 56px 48px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <p style={{ margin: 0, fontSize: 18, color: "rgba(255,255,255,0.75)", fontWeight: 600 }}>
            {orgName} · {dateStr}
          </p>
          <h1 style={{ margin: 0, fontSize: 52, fontWeight: 900, color: "#ffffff", lineHeight: 1.1, maxWidth: 900 }}>
            {event.title}
          </h1>
          {event.description && (
            <p style={{ margin: 0, fontSize: 22, color: "rgba(255,255,255,0.8)", maxWidth: 800, lineHeight: 1.4 }}>
              {event.description.slice(0, 120)}{event.description.length > 120 ? "…" : ""}
            </p>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 4 }}>
            {event.is_virtual && (
              <span style={{ fontSize: 15, color: "rgba(255,255,255,0.7)", background: "rgba(255,255,255,0.15)", padding: "4px 14px", borderRadius: 20, fontWeight: 600 }}>
                Virtual
              </span>
            )}
            {!event.is_virtual && event.location && (
              <span style={{ fontSize: 15, color: "rgba(255,255,255,0.7)", fontWeight: 500 }}>
                📍 {event.location}
              </span>
            )}
          </div>
        </div>

        {/* CSC logo text — top right */}
        <div
          style={{
            position: "absolute",
            top: 48,
            right: 56,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ fontSize: 18, fontWeight: 800, color: "rgba(255,255,255,0.9)", letterSpacing: 1 }}>
            CAMPUS STORES CANADA
          </span>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
