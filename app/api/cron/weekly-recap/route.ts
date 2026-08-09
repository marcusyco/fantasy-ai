import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAuthorizedCronRequest } from '@/lib/cron-auth';
import { collectText } from '@/lib/ai/gateway';
import { sendTextMessage } from '@/lib/linq/client';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Sends every manager a short, personality-forward recap of the just-
 * finished week (scores, standings movement, a little trash talk).
 * Scheduled for Tuesday per vercel.json, after Monday Night Football.
 *
 * Relies on `league_data_cache` already being fresh — run
 * /api/cron/sync-leagues first (it runs every 15 min, so this is safe).
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data: leagues } = await supabase.from('leagues').select('id, name');

  const summary: Record<string, unknown> = {};

  for (const league of leagues ?? []) {
    const [{ data: scoreboardRow }, { data: standingsRow }, { data: managers }] = await Promise.all([
      supabase
        .from('league_data_cache')
        .select('payload, week')
        .eq('league_id', league.id)
        .eq('data_type', 'scoreboard')
        .order('synced_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('league_data_cache')
        .select('payload')
        .eq('league_id', league.id)
        .eq('data_type', 'standings')
        .order('synced_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from('managers').select('id, display_name, phone_e164').eq('league_id', league.id),
    ]);

    if (!scoreboardRow || !managers?.length) {
      summary[league.id] = { skipped: 'no cached scoreboard or no managers' };
      continue;
    }

    const week = scoreboardRow.week ?? 0;

    const sent: string[] = [];
    const skipped: string[] = [];

    for (const manager of managers) {
      const { data: already } = await supabase
        .from('scheduled_sends')
        .select('id')
        .eq('league_id', league.id)
        .eq('manager_id', manager.id)
        .eq('kind', 'weekly_recap')
        .eq('week', week)
        .maybeSingle();

      if (already) {
        skipped.push(manager.id);
        continue;
      }

      const recap = await collectText({
        system: [
          `You write short, funny weekly recap texts for the fantasy football league "${league.name}".`,
          `Write ONE text message (2-4 sentences, no markdown) for ${manager.display_name} covering week ${week}:`,
          'their result, one standout performance league-wide, and a light jab or compliment.',
          `Scoreboard data: ${JSON.stringify(scoreboardRow.payload).slice(0, 3000)}`,
          `Standings data: ${JSON.stringify(standingsRow?.payload ?? {}).slice(0, 2000)}`,
        ].join('\n'),
        messages: [{ role: 'user', content: `Write this week's recap for ${manager.display_name}.` }],
      });

      await sendTextMessage(manager.phone_e164, recap);

      await Promise.all([
        supabase.from('scheduled_sends').insert({
          league_id: league.id,
          manager_id: manager.id,
          kind: 'weekly_recap',
          week,
        }),
        supabase.from('messages').insert({
          league_id: league.id,
          manager_id: manager.id,
          direction: 'outbound',
          body: recap,
        }),
      ]);

      sent.push(manager.id);
    }

    summary[league.id] = { week, sent: sent.length, skipped: skipped.length };
  }

  return NextResponse.json({ summary });
}
