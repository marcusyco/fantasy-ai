-- Allow leagues to exist without a Yahoo connection, and give each league a
-- freeform markdown blob (league history, rules, past drafts, running jokes)
-- that the AI assistant includes in its system prompt as a substitute for
-- (or supplement to) live Yahoo data.

alter table leagues alter column yahoo_league_key drop not null;
alter table leagues add column context_markdown text;
