import { createClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";

/**
 * Service-role Supabase client — bypasses RLS.
 *
 * Use ONLY in trusted server contexts:
 * - Webhook handlers (no user auth context)
 * - Background jobs / crons
 * - System-level operations that run without a logged-in user
 *
 * NEVER expose to client-side code or import from client components.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
    );
  }

  return createClient<Database>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
