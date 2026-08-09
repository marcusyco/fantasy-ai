import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

/**
 * Anon-key Supabase client for use in the dashboard (server components /
 * route handlers that run on behalf of a logged-in user). Respects RLS —
 * pair with a forwarded Supabase Auth session/cookie in real usage.
 *
 * This scaffold does not implement the dashboard UI; this client is here
 * so a future admin dashboard has a correctly-scoped starting point
 * instead of reaching for the admin client out of convenience.
 */
export function createServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY env vars.'
    );
  }

  return createClient<Database>(url, anonKey);
}
