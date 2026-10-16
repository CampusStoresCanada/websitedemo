"use server";

import { requireAuthenticated } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

const SIGNED_URL_TTL_SECONDS = 900; // 15 minutes

/**
 * Signed, short-lived download links for CSC's own brand assets.
 *
 * The `brand-assets` bucket is private on purpose. These are credible
 * originals of the association's identity — the vector files a supplier would
 * use to decorate a real product — so they go to signed-in people and nobody
 * else. A signed URL expires, which means a link that leaks is a link that
 * stops working rather than a permanent mirror of the logo pack.
 *
 * Shorter TTL than conference documents (15 minutes vs an hour): a document is
 * something you read in place, a zip is something you click and have.
 */
const ASSETS = {
  "csc-logos": {
    path: "csc-logos.zip",
    filename: "CSC-Logos.zip",
    label: "CSC logo pack",
  },
} as const;

export type BrandAssetKey = keyof typeof ASSETS;

export async function getBrandAssetUrl(
  key: BrandAssetKey
): Promise<{ success: true; url: string; filename: string } | { success: false; error: string }> {
  // Any signed-in account, not just partners: members decorate things too, and
  // the gate here is "we know who you are", not "you are buying something".
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: "Sign in to download the logo pack." };

  const asset = ASSETS[key];
  if (!asset) return { success: false, error: "Unknown asset." };

  const { data, error } = await createAdminClient()
    .storage.from("brand-assets")
    .createSignedUrl(asset.path, SIGNED_URL_TTL_SECONDS, { download: asset.filename });

  if (error || !data?.signedUrl) {
    console.error("[getBrandAssetUrl] failed to sign", key, error);
    return { success: false, error: "That download is unavailable right now." };
  }

  return { success: true, url: data.signedUrl, filename: asset.filename };
}
