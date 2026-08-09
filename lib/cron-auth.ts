import { NextRequest } from 'next/server';

/**
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically on
 * every cron-triggered invocation once CRON_SECRET is set as an env var —
 * see https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs.
 * This also accepts a `?secret=` query param so the routes are easy to
 * trigger manually while testing locally.
 */
export function isAuthorizedCronRequest(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // no secret configured — allow (dev-only footgun, see README)

  const authHeader = request.headers.get('authorization');
  if (authHeader === `Bearer ${secret}`) return true;

  const { searchParams } = new URL(request.url);
  return searchParams.get('secret') === secret;
}
