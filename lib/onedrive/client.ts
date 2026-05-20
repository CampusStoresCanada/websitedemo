/**
 * Microsoft Graph API client — Board Portal
 *
 * Uses client credentials (app-level) auth via Entra ID.
 * No user interaction required. Token is cached in-process
 * and refreshed automatically on expiry.
 *
 * Env vars:
 *   CSC_BOARD_PORTAL_DIRECTORY  — tenant ID
 *   CSC_BOARD_PORTAL_APPLICATION — client ID
 *   CSC_BOARD_PORTAL_VALUE      — client secret value
 */

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

// In-process token cache — resets on cold start (fine for serverless)
let cachedToken: string | null = null;
let cacheExpiresAt = 0;

function getConfig() {
  const tenantId     = process.env.CSC_BOARD_PORTAL_DIRECTORY;
  const clientId     = process.env.CSC_BOARD_PORTAL_APPLICATION;
  const clientSecret = process.env.CSC_BOARD_PORTAL_VALUE;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error(
      "Missing Entra ID config. Required: CSC_BOARD_PORTAL_DIRECTORY, " +
      "CSC_BOARD_PORTAL_APPLICATION, CSC_BOARD_PORTAL_VALUE"
    );
  }

  return { tenantId, clientId, clientSecret };
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cacheExpiresAt - 60_000) {
    return cachedToken;
  }

  const { tenantId, clientId, clientSecret } = getConfig();

  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type:    "client_credentials",
        client_id:     clientId,
        client_secret: clientSecret,
        scope:         "https://graph.microsoft.com/.default",
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Entra ID token fetch failed (${res.status}): ${text}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  cachedToken    = data.access_token;
  cacheExpiresAt = Date.now() + data.expires_in * 1000;

  return cachedToken;
}

async function graphFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await getAccessToken();

  const res = await fetch(`${GRAPH_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph API error ${res.status} on ${path}: ${text}`);
  }

  return res.json() as Promise<T>;
}

// ─────────────────────────────────────────────────────────────────
// Drive discovery
// ─────────────────────────────────────────────────────────────────

export interface GraphDrive {
  id:   string;
  name: string;
}

/** Returns all drives the app can see — used once during setup to find the right drive ID. */
export async function listDrives(): Promise<GraphDrive[]> {
  // List drives across all sites the app has access to
  const data = await graphFetch<{ value: GraphDrive[] }>("/sites/root/drives");
  return data.value;
}

/** Returns the drive object for the ED's OneDrive for Business. */
export async function getUserDrive(userPrincipalName: string): Promise<GraphDrive> {
  return graphFetch<GraphDrive>(`/users/${userPrincipalName}/drive`);
}

// ─────────────────────────────────────────────────────────────────
// Folder + file operations
// ─────────────────────────────────────────────────────────────────

export interface GraphDriveItem {
  id:                 string;
  name:               string;
  size:               number;
  webUrl:             string;
  parentReference:    { path: string };
  file?:              { mimeType: string };
  folder?:            { childCount: number };
  lastModifiedDateTime: string;
}

export interface GraphDelta {
  value:         GraphDriveItem[];
  "@odata.nextLink"?:  string;
  "@odata.deltaLink"?: string;
}

/**
 * Fetches the full delta for a folder path on a given drive.
 * On first call pass deltaToken = null → returns all items + a delta token.
 * On subsequent calls pass the saved delta token → returns only changes.
 */
export async function fetchDelta(
  driveId: string,
  folderPath: string,
  deltaToken: string | null
): Promise<{ items: GraphDriveItem[]; nextDeltaToken: string }> {
  const encodedPath = encodeURIComponent(folderPath);

  // Start URL: either the delta token or a fresh delta request
  let url: string = deltaToken
    ? `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodedPath}:/delta?$deltatoken=${deltaToken}`
    : `/drives/${driveId}/root:/${encodedPath}:/delta`;

  const items: GraphDriveItem[] = [];
  let nextDeltaToken = "";

  // Page through all results
  while (url) {
    const isAbsolute = url.startsWith("https://");
    const data: GraphDelta = isAbsolute
      ? await (async () => {
          const token = await getAccessToken();
          const res   = await fetch(url, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!res.ok) throw new Error(`Graph delta error ${res.status}`);
          return res.json() as Promise<GraphDelta>;
        })()
      : await graphFetch<GraphDelta>(url);

    items.push(...data.value);

    if (data["@odata.nextLink"]) {
      url = data["@odata.nextLink"];
    } else if (data["@odata.deltaLink"]) {
      // Extract just the deltatoken param value for storage
      const u = new URL(data["@odata.deltaLink"]);
      nextDeltaToken = u.searchParams.get("$deltatoken") ?? data["@odata.deltaLink"];
      url = "";
    } else {
      url = "";
    }
  }

  return { items, nextDeltaToken };
}

/**
 * Downloads a file from OneDrive and returns it as an ArrayBuffer.
 */
export async function downloadFile(driveId: string, itemId: string): Promise<ArrayBuffer> {
  const token = await getAccessToken();

  // First get the download URL
  const meta = await graphFetch<{ "@microsoft.graph.downloadUrl": string }>(
    `/drives/${driveId}/items/${itemId}?select=id,@microsoft.graph.downloadUrl`
  );

  const downloadUrl = meta["@microsoft.graph.downloadUrl"];
  if (!downloadUrl) {
    throw new Error(`No download URL for item ${itemId}`);
  }

  const res = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`File download failed (${res.status}) for item ${itemId}`);
  }

  return res.arrayBuffer();
}
