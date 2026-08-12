import type { CoreMessage } from 'ai';
import { createAdminClient } from '@/lib/supabase/admin';
import { collectText } from '@/lib/ai/gateway';

const HISTORY_LIMIT = 10;
const MAX_CACHE_CHARS = 4000; // keep cached Yahoo payloads from blowing out the context window

function truncate(json: unknown, max = MAX_CACHE_CHARS): string {
  const str = JSON.stringify(json);
  return str.length > max ? `${str.slice(0, max)}… (truncated)` : str;
}

function buildSystemPrompt(params: {
  leagueName: string;
  season: number;
  managerName: string;
  isCommissioner: boolean;
  standings: unknown | null;
  scoreboard: unknown | null;
  contextMarkdown: string | null;
}): string {
  const { leagueName, season, managerName, isCommissioner, standings, scoreboard, contextMarkdown } = params;

  return [
    `You are the AI assistant for the fantasy football league "${leagueName}" (${season} season).`,
    `You're texting with ${managerName}${isCommissioner ? ', who is the league commissioner' : ''} over iMessage.`,
    '',
    'Tone: sound like a sharp, funny group-chat friend, not a customer support bot. Keep',
    'replies short enough for a text message (usually 1-4 sentences). No markdown, no bullet',
    'points, no headers — this renders as plain iMessage text.',
    '',
    'Ground every factual claim (scores, standings, records, roster moves, past trades/drafts)',
    'in the league data below. If something the manager asks about isn\'t in this data, say',
    'you\'re not sure rather than guessing.',
    '',
    `Current standings (Yahoo Fantasy, cached): ${standings ? truncate(standings) : 'not synced yet'}`,
    `Current scoreboard (Yahoo Fantasy, cached): ${scoreboard ? truncate(scoreboard) : 'not synced yet'}`,
    '',
    'League history and context (commissioner-provided):',
    contextMarkdown ?? 'none provided yet',
  ].join('\n');
}

export interface AssistantReplyParams {
  leagueId: string;
  managerId: string;
  incomingText: string;
}

/**
 * Builds context (league + cached Yahoo data + recent conversation) and
 * returns the assistant's reply text for one inbound iMessage. Does not
 * persist anything — the caller (webhook route) owns writing both the
 * inbound and outbound `messages` rows so retries/failures don't leave the
 * log half-written.
 */
export async function generateAssistantReply({
  leagueId,
  managerId,
  incomingText,
}: AssistantReplyParams): Promise<string> {
  const supabase = createAdminClient();

  const [{ data: league }, { data: manager }, { data: standingsRow }, { data: scoreboardRow }, { data: history }] =
    await Promise.all([
      supabase.from('leagues').select('name, season, context_markdown').eq('id', leagueId).single(),
      supabase
        .from('managers')
        .select('display_name, is_commissioner')
        .eq('id', managerId)
        .single(),
      supabase
        .from('league_data_cache')
        .select('payload')
        .eq('league_id', leagueId)
        .eq('data_type', 'standings')
        .order('synced_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('league_data_cache')
        .select('payload')
        .eq('league_id', leagueId)
        .eq('data_type', 'scoreboard')
        .order('synced_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('messages')
        .select('direction, body, created_at')
        .eq('manager_id', managerId)
        .order('created_at', { ascending: false })
        .limit(HISTORY_LIMIT),
    ]);

  if (!league || !manager) {
    throw new Error(`Could not load league (${leagueId}) or manager (${managerId}) context.`);
  }

  const system = buildSystemPrompt({
    leagueName: league.name,
    season: league.season,
    managerName: manager.display_name,
    isCommissioner: manager.is_commissioner,
    standings: standingsRow?.payload ?? null,
    scoreboard: scoreboardRow?.payload ?? null,
    contextMarkdown: league.context_markdown,
  });

  const conversation: CoreMessage[] = (history ?? [])
    .slice()
    .reverse()
    .map((row) => ({
      role: row.direction === 'inbound' ? 'user' : 'assistant',
      content: row.body,
    }));

  conversation.push({ role: 'user', content: incomingText });

  return collectText({ system, messages: conversation });
}
