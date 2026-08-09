import { createAdminClient } from '@/lib/supabase/admin';
import { refreshAccessToken } from '@/lib/yahoo/oauth';

const FANTASY_API_BASE = 'https://fantasysports.yahooapis.com/fantasy/v2';

/**
 * Returns a valid Yahoo access token for a league, transparently
 * refreshing (and persisting the new token) if the cached one is expired
 * or about to expire. Yahoo access tokens live ~1 hour; refresh tokens are
 * long-lived until revoked.
 */
export async function getFreshAccessToken(leagueId: string): Promise<string> {
  const supabase = createAdminClient();
  const { data: conn, error } = await supabase
    .from('yahoo_connections')
    .select('*')
    .eq('league_id', leagueId)
    .single();

  if (error || !conn) {
    throw new Error(`No Yahoo connection found for league ${leagueId}: ${error?.message ?? ''}`);
  }

  const expiresAt = new Date(conn.expires_at).getTime();
  const isExpiringSoon = expiresAt - Date.now() < 60_000; // refresh 1 min ahead

  if (!isExpiringSoon) {
    return conn.access_token;
  }

  const refreshed = await refreshAccessToken(conn.refresh_token);
  const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();

  await supabase
    .from('yahoo_connections')
    .update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token, // Yahoo rotates this on refresh
      expires_at: newExpiresAt,
    })
    .eq('league_id', leagueId);

  return refreshed.access_token;
}

async function fantasyGet<T>(path: string, accessToken: string): Promise<T> {
  const separator = path.includes('?') ? '&' : '?';
  const res = await fetch(`${FANTASY_API_BASE}/${path}${separator}format=json`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Yahoo Fantasy API request failed (${res.status}): ${raw}`);
  }
  return JSON.parse(raw) as T;
}

/**
 * These return the raw Yahoo `fantasy_content` envelope (deeply nested,
 * numeric-keyed arrays — a long-standing quirk of this API). Callers
 * should normalize into flat shapes before caching/using in prompts; see
 * `lib/yahoo/normalize.ts` for where that logic should live as the schema
 * mapping is fleshed out.
 */

/** League metadata (name, current_week, scoring type, etc.) — no sub-resources. */
export function getLeagueMeta(leagueKey: string, accessToken: string) {
  return fantasyGet<unknown>(`league/${leagueKey}/metadata`, accessToken);
}

export function getStandings(leagueKey: string, accessToken: string) {
  return fantasyGet<unknown>(`league/${leagueKey}/standings`, accessToken);
}

export function getScoreboard(leagueKey: string, week: number, accessToken: string) {
  return fantasyGet<unknown>(`league/${leagueKey}/scoreboard;week=${week}`, accessToken);
}

export function getTeams(leagueKey: string, accessToken: string) {
  return fantasyGet<unknown>(`league/${leagueKey}/teams`, accessToken);
}

export function getTeamRoster(teamKey: string, week: number, accessToken: string) {
  return fantasyGet<unknown>(`team/${teamKey}/roster;week=${week}`, accessToken);
}

export function getTransactions(leagueKey: string, accessToken: string) {
  return fantasyGet<unknown>(`league/${leagueKey}/transactions`, accessToken);
}

/**
 * Lists the authenticated Yahoo user's fantasy football leagues.
 * `game_keys=nfl` (literal string, not a numeric key) is Yahoo's shorthand
 * for "the current NFL season" and is what the OAuth callback uses to let
 * a commissioner pick which league to connect.
 */
export function getUserNflLeagues(accessToken: string) {
  return fantasyGet<unknown>('users;use_login=1/games;game_keys=nfl/leagues', accessToken);
}

