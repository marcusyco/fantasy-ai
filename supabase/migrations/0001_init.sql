-- Fantasy AI: initial schema
-- Multi-tenant model: one "organization" = one paying customer/commissioner
-- account, which can connect one or more Yahoo Fantasy leagues. Each league
-- has many managers (fantasy team owners), each reachable over iMessage via
-- Linq. All cross-league/cross-org data access is blocked by RLS below;
-- server routes (webhooks, cron) use the Supabase service role key, which
-- bypasses RLS by design, since they act on behalf of the whole platform.

create extension if not exists pgcrypto;

-- ── Tenancy ────────────────────────────────────────────────────────────────

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- Links a Supabase Auth user (dashboard login) to an organization.
create table org_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);

-- ── Leagues ─────────────────────────────────────────────────────────────────

create table leagues (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  name text not null,
  sport text not null default 'nfl',
  season int not null,
  yahoo_league_key text not null unique, -- e.g. "449.l.123456"
  timezone text not null default 'America/New_York',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index leagues_org_id_idx on leagues (org_id);

-- One Yahoo OAuth grant per league (typically the commissioner's login).
-- League-level Fantasy resources (standings, scoreboard, every team's
-- roster) are readable with a single member's token, so we don't need a
-- separate Yahoo OAuth per manager.
create table yahoo_connections (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null unique references leagues (id) on delete cascade,
  yahoo_guid text,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  scope text not null default 'fspt-r',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Managers (fantasy team owners) ─────────────────────────────────────────

create table managers (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues (id) on delete cascade,
  yahoo_team_key text, -- e.g. "449.l.123456.t.4"; null until matched/confirmed
  display_name text not null,
  phone_e164 text not null,
  is_commissioner boolean not null default false,
  timezone text not null default 'America/New_York',
  opted_in_at timestamptz,
  created_at timestamptz not null default now(),
  unique (league_id, phone_e164)
);

create index managers_phone_idx on managers (phone_e164);

-- Caches the Linq chat_id for each manager so replies land in the same
-- iMessage thread instead of Linq auto-creating a new one every send.
create table linq_chats (
  id uuid primary key default gen_random_uuid(),
  manager_id uuid not null unique references managers (id) on delete cascade,
  linq_chat_id text not null,
  created_at timestamptz not null default now()
);

-- ── Conversation log ────────────────────────────────────────────────────────

create table messages (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues (id) on delete cascade,
  manager_id uuid references managers (id) on delete set null,
  direction text not null check (direction in ('inbound', 'outbound')),
  body text not null,
  linq_message_id text,
  linq_event_id text unique, -- dedupes retried webhook deliveries
  created_at timestamptz not null default now()
);

create index messages_league_id_idx on messages (league_id, created_at desc);
create index messages_manager_id_idx on messages (manager_id, created_at desc);

-- ── Cached Yahoo data ────────────────────────────────────────────────────────

create table league_data_cache (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues (id) on delete cascade,
  data_type text not null check (data_type in ('standings', 'scoreboard', 'rosters', 'transactions')),
  week int, -- null for week-independent data (e.g. standings, rosters)
  payload jsonb not null,
  synced_at timestamptz not null default now(),
  unique (league_id, data_type, week)
);

-- ── Idempotency guard for proactive sends (cron) ────────────────────────────

create table scheduled_sends (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues (id) on delete cascade,
  manager_id uuid references managers (id) on delete cascade,
  kind text not null check (kind in ('lineup_reminder', 'weekly_recap', 'injury_alert')),
  week int not null,
  sent_at timestamptz not null default now(),
  unique (league_id, manager_id, kind, week)
);

-- ── updated_at triggers ──────────────────────────────────────────────────────

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger leagues_set_updated_at before update on leagues
  for each row execute function set_updated_at();

create trigger yahoo_connections_set_updated_at before update on yahoo_connections
  for each row execute function set_updated_at();

-- ── Row Level Security ──────────────────────────────────────────────────────
-- These policies protect direct client-side access (e.g. a dashboard using
-- the anon key + Supabase Auth session). Server routes use the service
-- role key and bypass RLS entirely, which is required since Linq webhooks
-- and Vercel Cron requests have no Supabase Auth session at all.

alter table organizations enable row level security;
alter table org_members enable row level security;
alter table leagues enable row level security;
alter table yahoo_connections enable row level security;
alter table managers enable row level security;
alter table linq_chats enable row level security;
alter table messages enable row level security;
alter table league_data_cache enable row level security;
alter table scheduled_sends enable row level security;

create or replace function is_org_member(target_org_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from org_members
    where org_id = target_org_id and user_id = auth.uid()
  );
$$;

create policy "members read own org" on organizations
  for select using (is_org_member(id));

create policy "members read own membership rows" on org_members
  for select using (is_org_member(org_id));

create policy "members manage own leagues" on leagues
  for all using (is_org_member(org_id)) with check (is_org_member(org_id));

create policy "members read own yahoo connections" on yahoo_connections
  for select using (
    exists (select 1 from leagues l where l.id = league_id and is_org_member(l.org_id))
  );

create policy "members manage own managers" on managers
  for all using (
    exists (select 1 from leagues l where l.id = league_id and is_org_member(l.org_id))
  ) with check (
    exists (select 1 from leagues l where l.id = league_id and is_org_member(l.org_id))
  );

create policy "members read own linq chats" on linq_chats
  for select using (
    exists (
      select 1 from managers m
      join leagues l on l.id = m.league_id
      where m.id = manager_id and is_org_member(l.org_id)
    )
  );

create policy "members read own messages" on messages
  for select using (
    exists (select 1 from leagues l where l.id = league_id and is_org_member(l.org_id))
  );

create policy "members read own cached data" on league_data_cache
  for select using (
    exists (select 1 from leagues l where l.id = league_id and is_org_member(l.org_id))
  );

create policy "members read own scheduled sends" on scheduled_sends
  for select using (
    exists (select 1 from leagues l where l.id = league_id and is_org_member(l.org_id))
  );
