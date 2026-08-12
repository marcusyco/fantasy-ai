import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAuthorizedCronRequest } from '@/lib/cron-auth';
import { getFreshAccessToken, getLeagueMeta, getStandings, getScoreboard } from '@/lib/yahoo/client';
import { extractCurrentWeek } from '@/lib/yahoo/normalize';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Pulls current standings + this week's scoreboard for every connected
 * league and caches them in `league_data_cache`. The AI assistant reads
 * from this cache (see lib/ai/assistant.ts) rather than hitting Yahoo
 * directly on every text message, since Yahoo Fantasy API rate limits are
 * generous but not "one iMessage per manager per league per turn" generous.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data: leagues, error } = await supabase.from('leagues').select('id, yahoo_league_key');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results = await Promise.all(
    (leagues ?? []).map(async (league) => {
      if (!league.yahoo_league_key) {
        return { leagueId: league.id, ok: true, skipped: 'no Yahoo connection' };
      }

      try {
        const accessToken = await getFreshAccessToken(league.id);
        const meta = await getLeagueMeta(league.yahoo_league_key, accessToken);
        const currentWeek = extractCurrentWeek(meta) ?? 1;

        const [standings, scoreboard] = await Promise.all([
          getStandings(league.yahoo_league_key, accessToken),
          getScoreboard(league.yahoo_league_key, currentWeek, accessToken),
        ]);

        await Promise.all([
          supabase.from('league_data_cache').upsert(
            {
              league_id: league.id,
              data_type: 'standings',
              week: null,
              payload: standings,
              synced_at: new Date().toISOString(),
            },
            { onConflict: 'league_id,data_type,week' }
          ),
          supabase.from('league_data_cache').upsert(
            {
              league_id: league.id,
              data_type: 'scoreboard',
              week: currentWeek,
              payload: scoreboard,
              synced_at: new Date().toISOString(),
            },
            { onConflict: 'league_id,data_type,week' }
          ),
        ]);

        return { leagueId: league.id, ok: true, currentWeek };
      } catch (err) {
        console.error(`Failed to sync league ${league.id}`, err);
        return { leagueId: league.id, ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    })
  );

  return NextResponse.json({ synced: results });
}
