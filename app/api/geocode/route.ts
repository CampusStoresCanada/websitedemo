import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { geocodeAddress } from "@/lib/geocode";

// Create an untyped client for this API route since we're dealing with lat/lng columns
// that may not be in the simplified types
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface OrgForGeocoding {
  id: string;
  name: string;
  street_address: string | null;
  city: string | null;
  province: string | null;
  postal_code: string | null;
}

// POST /api/geocode - Geocode all organizations missing coordinates
export async function POST() {
  // Fetch organizations without coordinates
  const { data, error } = await supabase
    .from("organizations")
    .select("id, name, street_address, city, province, postal_code")
    .is("archived_at", null)
    .or("latitude.is.null,longitude.is.null")
    .not("city", "is", null);

  const orgs = data as OrgForGeocoding[] | null;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!orgs || orgs.length === 0) {
    return NextResponse.json({
      message: "All organizations already have coordinates",
      geocoded: 0,
    });
  }

  let geocoded = 0;
  let failed = 0;
  const results: Array<{ name: string; status: string }> = [];

  // Process each organization
  for (const org of orgs) {
    if (!org.city || !org.province) {
      results.push({ name: org.name, status: "skipped - no city/province" });
      continue;
    }

    const coords = await geocodeAddress(
      org.street_address || "",
      org.city,
      org.province,
      org.postal_code
    );

    if (coords) {
      // Update the organization with coordinates
      const { error: updateError } = await supabase
        .from("organizations")
        .update({
          latitude: coords.latitude,
          longitude: coords.longitude,
        })
        .eq("id", org.id);

      if (updateError) {
        results.push({ name: org.name, status: `error: ${updateError.message}` });
        failed++;
      } else {
        results.push({
          name: org.name,
          status: `success: ${coords.latitude}, ${coords.longitude}`,
        });
        geocoded++;
      }
    } else {
      results.push({ name: org.name, status: "failed - no geocode result" });
      failed++;
    }

    // Small delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return NextResponse.json({
    message: `Geocoded ${geocoded} organizations`,
    total: orgs.length,
    geocoded,
    failed,
    results,
  });
}

// GET /api/geocode - Check geocoding status
export async function GET() {
  const { count: total } = await supabase
    .from("organizations")
    .select("*", { count: "exact", head: true })
    .is("archived_at", null);

  const { count: withCoords } = await supabase
    .from("organizations")
    .select("*", { count: "exact", head: true })
    .is("archived_at", null)
    .not("latitude", "is", null)
    .not("longitude", "is", null);

  const { count: needsGeocoding } = await supabase
    .from("organizations")
    .select("*", { count: "exact", head: true })
    .is("archived_at", null)
    .or("latitude.is.null,longitude.is.null")
    .not("city", "is", null);

  return NextResponse.json({
    total: total || 0,
    withCoordinates: withCoords || 0,
    needsGeocoding: needsGeocoding || 0,
  });
}
