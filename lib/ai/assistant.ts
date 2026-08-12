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
  isGroup: boolean;
  standings: unknown | null;
  scoreboard: unknown | null;
  contextMarkdown: string | null;
}): string {
  const { leagueName, season, managerName, isCommissioner, isGroup, standings, scoreboard, contextMarkdown } = params;

  const audience = isGroup
    ? [
        `You're in a group iMessage/RCS/SMS thread with multiple managers from this league — could be the`,
        `whole league or just a few managers hashing out a trade. You only see messages here that`,
        `explicitly mention you ("CommishBot" or "CommishAI"); the message below is from ${managerName}`,
        `${isCommissioner ? '(the commissioner) ' : ''}addressing you that way. Earlier lines in the`,
        `history are prefixed with who said them — use those names when it helps (e.g. referring to both`,
        `sides of a trade), but don't over-explain who's who if it's not relevant.`,
      ].join(' ')
    : `You're texting one-on-one with ${managerName}${isCommissioner ? ', who is the league commissioner' : ''} over iMessage.`;

  return [
    `You are the AI assistant for the fantasy football league "${leagueName}" (${season} season) —`,
    'an expert fantasy football analyst, not a generic chatbot. You reason the way a good analyst',
    'does: current usage/role, matchup, injury status, and expert consensus all matter more than a',
    'player\'s name recognition. You have live web search available — use it for anything',
    'time-sensitive (injuries, depth chart changes, trades, suspensions, breaking news) instead of',
    'relying on what you already "know", since a player\'s situation can change hours before someone',
    'asks about it. Don\'t recommend a player as a start/keep/hold without accounting for their',
    'current health and role.',
    '',
    audience,
    '',
    'Tone: sound like a sharp, funny group-chat friend, not a customer support bot. Keep',
    'replies short enough for a text message (usually 1-4 sentences). No markdown, no bullet',
    'points, no headers — this renders as plain iMessage text.',
    '',
    'Ground every factual claim (scores, standings, records, roster moves, past trades/drafts)',
    'in the league data below or in what you find via search. If something the manager asks about',
    'isn\'t in this data and search doesn\'t turn it up, say you\'re not sure rather than guessing.',
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
  chatThreadId: string;
  isGroup: boolean;
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
  chatThreadId,
  isGroup,
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
        .select('direction, body, manager_id, created_at')
        .eq('chat_thread_id', chatThreadId)
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
    isGroup,
    standings: standingsRow?.payload ?? null,
    scoreboard: scoreboardRow?.payload ?? null,
    contextMarkdown: league.context_markdown,
  });

  // Group threads have multiple human senders funneled into the single
  // `user` role the model sees — bake the sender's name into the message
  // text itself so the model can tell who said what.
  let namesByManagerId = new Map<string, string>();
  if (isGroup && history && history.length > 0) {
    const managerIds = [...new Set(history.map((row) => row.manager_id).filter((id): id is string => !!id))];
    if (managerIds.length > 0) {
      const { data: senders } = await supabase.from('managers').select('id, display_name').in('id', managerIds);
      namesByManagerId = new Map((senders ?? []).map((sender) => [sender.id, sender.display_name]));
    }
  }

  const conversation: CoreMessage[] = (history ?? [])
    .slice()
    .reverse()
    .map((row) => {
      const isInbound = row.direction === 'inbound';
      const speakerName = row.manager_id ? namesByManagerId.get(row.manager_id) : undefined;
      const content = isGroup && isInbound && speakerName ? `${speakerName}: ${row.body}` : row.body;
      return { role: isInbound ? 'user' : 'assistant', content };
    });

  conversation.push({
    role: 'user',
    content: isGroup ? `${manager.display_name}: ${incomingText}` : incomingText,
  });

  return collectText({ system, messages: conversation });
}
