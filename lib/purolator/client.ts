// Purolator REST client — token lifecycle and one request function.
//
// Proven against the sandbox on 2026-11-03 (docs/purolator/). The token call
// accepts exactly one shape: Basic client_id:secret, the x-api-key header,
// and a JSON client_credentials body; anything else is a vague 400.
//
// A 403 "Invalid key=value pair ... in Authorization header" means the ROUTE
// does not exist (it is AWS API Gateway talking), not that auth failed.

import "server-only";

const HOSTS = {
  sandbox: "https://shipapi-sandbox.purolator.com",
  production: "https://shipapi.purolator.com",
} as const;

export class PurolatorError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Purolator's error codes, e.g. "9001-13" for an invalid billing account. */
    readonly codes: string[],
    /** Quote this to Purolator support. */
    readonly requestReference: string | null
  ) {
    super(message);
    this.name = "PurolatorError";
  }
}

// Purolator's sandbox only knows its own test accounts: CSC's real account
// number is "invalid" there (seen 2026-11-04). So the sandbox bills its test
// account unless told otherwise, and CSC's real number is used in production.
const SANDBOX_TEST_ACCOUNT = "9999999999";

export function getPurolatorConfig() {
  const clientId = process.env.PUROLATOR_CLIENT_ID;
  const clientSecret = process.env.PUROLATOR_CLIENT_SECRET;
  const apiKey = process.env.PUROLATOR_REST_API_KEY;
  const environment = process.env.PUROLATOR_ENV === "production" ? "production" : "sandbox";
  const billingAccount =
    environment === "production"
      ? process.env.PUROLATOR_BILLING_ACCOUNT
      : process.env.PUROLATOR_SANDBOX_BILLING_ACCOUNT || SANDBOX_TEST_ACCOUNT;

  if (!clientId || !clientSecret || !apiKey || !billingAccount) {
    throw new Error(
      "Missing PUROLATOR_CLIENT_ID, PUROLATOR_CLIENT_SECRET, PUROLATOR_REST_API_KEY or PUROLATOR_BILLING_ACCOUNT"
    );
  }
  return { clientId, clientSecret, apiKey, billingAccount, environment, host: HOSTS[environment] };
}

// Module-level token cache, as the QBO client does. Purolator's tokens last an
// hour; refresh a minute early so a request never carries one that expires in flight.
let cachedToken: string | null = null;
let cacheExpiresAt = 0;

export function resetPurolatorTokenCache() {
  cachedToken = null;
  cacheExpiresAt = 0;
}

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cacheExpiresAt) return cachedToken;

  const { clientId, clientSecret, apiKey, host } = getPurolatorConfig();
  const res = await fetch(`${host}/auth/v1/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ grant_type: "client_credentials" }),
  });
  if (!res.ok) {
    // Never echo the body: it can repeat what we sent.
    throw new PurolatorError(`Purolator sign-in failed (${res.status})`, res.status, [], null);
  }
  const json = (await res.json()) as { access_token: string; expires_in?: number };
  cachedToken = json.access_token;
  cacheExpiresAt = Date.now() + ((json.expires_in ?? 3600) - 60) * 1000;
  return cachedToken;
}

type ErrorBody = {
  requestReference?: string;
  errors?: Array<{ error?: { code?: string; description?: string } }>;
  message?: string;
};

export async function purolatorRequest<T>(
  method: "POST" | "PUT",
  path: string,
  body: unknown
): Promise<T> {
  const { apiKey, host } = getPurolatorConfig();
  const token = await getToken();

  const res = await fetch(`${host}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "x-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Gateway errors can be plain text.
  }

  if (!res.ok) {
    if (res.status === 401) resetPurolatorTokenCache();
    const err = (json ?? {}) as ErrorBody;
    const details = (err.errors ?? []).map((e) => e.error).filter(Boolean);
    const message =
      details.map((d) => d?.description).filter(Boolean).join("; ") ||
      err.message ||
      `Purolator returned ${res.status}`;
    throw new PurolatorError(
      message,
      res.status,
      details.map((d) => d?.code ?? "").filter(Boolean),
      err.requestReference ?? null
    );
  }
  return json as T;
}
