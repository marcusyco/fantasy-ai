/**
 * Yahoo's Fantasy Sports API (even with `format=json`) still returns its
 * legacy XML-derived shape: ordered collections are objects keyed by
 * stringified index ("0", "1", ...) plus a sibling `count` field, and
 * resources are arrays mixing flat metadata objects with nested
 * sub-resource objects. This file isolates that ugliness so the rest of
 * the app can work with plain arrays/objects.
 *
 * These helpers are deliberately defensive (lots of optional chaining and
 * fallbacks) because the exact shape has small inconsistencies across
 * resource types that are easiest to discover by logging a real response
 * rather than guessing further from docs alone.
 */

type YahooCollection = Record<string, unknown> & { count?: number };

function collectionToArray<T>(collection: unknown): T[] {
  if (Array.isArray(collection)) return collection as T[];
  if (!collection || typeof collection !== 'object') return [];
  const obj = collection as YahooCollection;
  return Object.keys(obj)
    .filter((key) => key !== 'count')
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => obj[key] as T);
}

function findArrayEntryWithKey<T = Record<string, unknown>>(
  arr: unknown[] | undefined,
  key: string
): T | undefined {
  return arr?.find((entry) => typeof entry === 'object' && entry !== null && key in entry) as
    | T
    | undefined;
}

export interface YahooLeagueSummary {
  leagueKey: string;
  name: string;
  season: string;
}

/** Flattens the response of `users;use_login=1/games;game_keys=nfl/leagues`. */
export function extractLeaguesFromUserLeaguesResponse(raw: unknown): YahooLeagueSummary[] {
  const fantasyContent = (raw as { fantasy_content?: unknown })?.fantasy_content;
  const users = collectionToArray<{ user?: unknown[] }>(
    (fantasyContent as { users?: unknown })?.users
  );

  const leagues: YahooLeagueSummary[] = [];

  for (const userEntry of users) {
    const gamesHolder = findArrayEntryWithKey<{ games?: unknown }>(userEntry.user, 'games');
    const games = collectionToArray<{ game?: unknown[] }>(gamesHolder?.games);

    for (const gameEntry of games) {
      const gameMeta = findArrayEntryWithKey<{ season?: string }>(gameEntry.game, 'season');
      const leaguesHolder = findArrayEntryWithKey<{ leagues?: unknown }>(
        gameEntry.game,
        'leagues'
      );
      const leagueEntries = collectionToArray<{ league?: unknown[] }>(leaguesHolder?.leagues);

      for (const leagueEntry of leagueEntries) {
        const meta = findArrayEntryWithKey<{ league_key?: string; name?: string }>(
          leagueEntry.league,
          'league_key'
        );
        if (meta?.league_key && meta?.name) {
          leagues.push({
            leagueKey: meta.league_key,
            name: meta.name,
            season: gameMeta?.season ?? 'unknown',
          });
        }
      }
    }
  }

  return leagues;
}

/** Flattens the response of `league/{league_key}/metadata`. */
export function extractCurrentWeek(raw: unknown): number | null {
  const fantasyContent = (raw as { fantasy_content?: unknown })?.fantasy_content;
  const league = (fantasyContent as { league?: unknown[] })?.league;
  const meta = findArrayEntryWithKey<{ current_week?: string | number }>(league, 'current_week');
  const week = meta?.current_week;
  if (week === undefined) return null;
  const parsed = Number(week);
  return Number.isFinite(parsed) ? parsed : null;
}
