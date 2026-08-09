import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeForTokens } from '@/lib/yahoo/oauth';
import { getUserNflLeagues } from '@/lib/yahoo/client';
import { extractLeaguesFromUserLeaguesResponse } from '@/lib/yahoo/normalize';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const yahooError = searchParams.get('error');

  if (yahooError) {
    return NextResponse.json({ error: `Yahoo denied authorization: ${yahooError}` }, { status: 400 });
  }
  if (!code || !state) {
    return NextResponse.json({ error: 'Missing code or state param.' }, { status: 400 });
  }

  let orgId: string;
  let leagueName: string;
  let season: string;
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
    orgId = decoded.orgId;
    leagueName = decoded.leagueName ?? '';
    season = decoded.season ?? String(new Date().getFullYear());
  } catch {
    return NextResponse.json({ error: 'Invalid state param.' }, { status: 400 });
  }

  const tokens = await exchangeCodeForTokens(code);

  const rawLeagues = await getUserNflLeagues(tokens.access_token);
  const leagues = extractLeaguesFromUserLeaguesResponse(rawLeagues);

  if (leagues.length === 0) {
    return NextResponse.json(
      { error: 'No NFL fantasy leagues found on this Yahoo account for the current season.' },
      { status: 404 }
    );
  }

  // Prefer an exact/substring name match (from the hint passed to
  // /api/yahoo/authorize); otherwise default to the first league and let
  // the commissioner confirm/change it later.
  const matched =
    leagues.find((l) => leagueName && l.name.toLowerCase().includes(leagueName.toLowerCase())) ??
    leagues[0]!;

  const supabase = createAdminClient();

  const { data: league, error: leagueError } = await supabase
    .from('leagues')
    .upsert(
      {
        org_id: orgId,
        name: leagueName || matched.name,
        season: Number(season),
        yahoo_league_key: matched.leagueKey,
      },
      { onConflict: 'yahoo_league_key' }
    )
    .select('id')
    .single();

  if (leagueError || !league) {
    return NextResponse.json(
      { error: `Failed to create league record: ${leagueError?.message}` },
      { status: 500 }
    );
  }

  const { error: connectionError } = await supabase.from('yahoo_connections').upsert(
    {
      league_id: league.id,
      yahoo_guid: tokens.xoauth_yahoo_guid ?? null,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    },
    { onConflict: 'league_id' }
  );

  if (connectionError) {
    return NextResponse.json(
      { error: `Failed to save Yahoo tokens: ${connectionError.message}` },
      { status: 500 }
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
  return NextResponse.json({
    ok: true,
    leagueId: league.id,
    matchedLeague: matched,
    otherLeaguesFound: leagues.filter((l) => l.leagueKey !== matched.leagueKey),
    nextStep: `Add managers' phone numbers for this league, then point them at ${appUrl} over iMessage.`,
  });
}
