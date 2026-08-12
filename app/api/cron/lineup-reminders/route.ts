import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAuthorizedCronRequest } from '@/lib/cron-auth';
import { sendTextMessage } from '@/lib/linq/client';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Sends a "lineups lock soon" nudge before kickoff. Scheduled Sunday per
 * vercel.json — adjust the cron expression in vercel.json if your league
 * isn't on the standard NFL Sunday slate (e.g. has a Thursday emphasis).
 *
 * TODO: this is intentionally a plain template, not an AI-generated or
 * roster-aware message. To flag *specific* empty starting spots or players
 * on bye, pull each manager's roster via `getTeamRoster` (lib/yahoo/client)
 * and extend `lib/yahoo/normalize.ts` to flatten the roster + player
 * status fields — that normalization isn't built out yet.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data: leagues } = await supabase.from('leagues').select('id, name');

  const summary: Record<string, unknown> = {};

  for (const league of leagues ?? []) {
    const { data: scoreboardRow } = await supabase
      .from('league_data_cache')
      .select('week')
      .eq('league_id', league.id)
      .eq('data_type', 'scoreboard')
      .order('synced_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const week = scoreboardRow?.week ?? 0;

    const { data: managers } = await supabase
      .from('managers')
      .select('id, display_name, phone_e164')
      .eq('league_id', league.id);

    let sent = 0;
    let skipped = 0;
    const failed: Array<{ managerId: string; error: string }> = [];

    for (const manager of managers ?? []) {
      const { data: already } = await supabase
        .from('scheduled_sends')
        .select('id')
        .eq('league_id', league.id)
        .eq('manager_id', manager.id)
        .eq('kind', 'lineup_reminder')
        .eq('week', week)
        .maybeSingle();

      if (already) {
        skipped++;
        continue;
      }

      const text = `Lineups lock soon for week ${week} in ${league.name} — double check your bench before kickoff.`;

      // One recipient's send failing (e.g. a Linq sandbox "recipient not
      // allowed" restriction) shouldn't stop everyone else in the league
      // from getting their reminder.
      try {
        await sendTextMessage(manager.phone_e164, text);
      } catch (err) {
        console.error(`Failed to send lineup reminder to manager ${manager.id}`, err);
        failed.push({ managerId: manager.id, error: err instanceof Error ? err.message : String(err) });
        continue;
      }

      await Promise.all([
        supabase.from('scheduled_sends').insert({
          league_id: league.id,
          manager_id: manager.id,
          kind: 'lineup_reminder',
          week,
        }),
        supabase.from('messages').insert({
          league_id: league.id,
          manager_id: manager.id,
          direction: 'outbound',
          body: text,
        }),
      ]);

      sent++;
    }

    summary[league.id] = { week, sent, skipped, failed };
  }

  return NextResponse.json({ summary });
}
