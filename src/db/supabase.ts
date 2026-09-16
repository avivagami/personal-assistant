import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config.js";

let client: SupabaseClient | undefined;

/**
 * Service-role client. Runs only on the server, never in a browser.
 * All assistant tables have RLS enabled with no policies, so this key is the
 * only way in.
 */
export function db(): SupabaseClient {
  if (client) return client;
  const c = config();
  client = createClient(c.SUPABASE_URL, c.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
