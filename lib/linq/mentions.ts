/**
 * In a group thread, the assistant should only jump in when addressed
 * directly (otherwise it'd reply to every message in a 13-person group
 * text). Managers can use either "CommishBot" or "CommishAI", with or
 * without a leading "@" — texting is inconsistent enough that we match all
 * of those forms rather than enforcing one exact syntax.
 */
const MENTION_PATTERN = /@?commish\s?(bot|ai)\b/i;

export function isBotMentioned(text: string): boolean {
  return MENTION_PATTERN.test(text);
}
