-- Generalizes conversation tracking beyond 1:1 manager threads so the
-- assistant can participate in group iMessage/RCS/SMS threads too (the full
-- league group, or an ad-hoc N:1 trade-discussion thread a few managers
-- create themselves by adding the bot's number to a group text).
--
-- Replaces `linq_chats`, which only modeled a single 1:1 chat per manager
-- and was never actually read/written by the application.

drop table if exists linq_chats;

create table chat_threads (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues (id) on delete cascade,
  linq_chat_id text not null unique,
  is_group boolean not null default false,
  created_at timestamptz not null default now()
);

create index chat_threads_league_id_idx on chat_threads (league_id);

alter table messages add column chat_thread_id uuid references chat_threads (id) on delete set null;
create index messages_chat_thread_id_idx on messages (chat_thread_id, created_at desc);

alter table chat_threads enable row level security;

create policy "members read own chat threads" on chat_threads
  for select using (
    exists (select 1 from leagues l where l.id = league_id and is_org_member(l.org_id))
  );
