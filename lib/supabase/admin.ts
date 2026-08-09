import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

/**
 * Service-role Supabase client. Bypasses Row Level Security entirely.
 *
 * Use this ONLY in trusted server contexts that have no Supabase Auth
 * session to scope against: Linq webhook handlers, Vercel Cron routes,
 * and the Yahoo OAuth callback. Never import this into anything that runs
 * in the browser, and never forward `SUPABASE_SERVICE_ROLE_KEY` to a
 * client component.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.'
    );
  }

  return createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
