import { NextRequest, NextResponse } from 'next/server';
import { buildAuthorizationUrl } from '@/lib/yahoo/oauth';

export const runtime = 'nodejs';

/**
 * Kicks off the Yahoo OAuth flow for a commissioner connecting a league.
 * Call as: /api/yahoo/authorize?orgId=<uuid>&leagueName=<name>&season=<year>
 *
 * `leagueName`/`season` are just hints used by the callback to pick the
 * right league out of the user's Yahoo account (see
 * lib/yahoo/normalize.ts) — Yahoo itself doesn't accept them as OAuth
 * params. TODO: replace this with a real dashboard flow that creates the
 * league row first and passes its id, instead of round-tripping raw
 * strings through the OAuth `state` param.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const orgId = searchParams.get('orgId');
  const leagueName = searchParams.get('leagueName') ?? '';
  const season = searchParams.get('season') ?? String(new Date().getFullYear());

  if (!orgId) {
    return NextResponse.json({ error: 'orgId query param is required' }, { status: 400 });
  }

  // TODO: this should also include a signed/random CSRF nonce that gets
  // verified in the callback, not just app-level context.
  const state = Buffer.from(JSON.stringify({ orgId, leagueName, season })).toString('base64url');

  return NextResponse.redirect(buildAuthorizationUrl(state));
}
