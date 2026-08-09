# Fantasy AI

A multi-tenant iMessage AI assistant for fantasy football leagues. Managers text
the assistant directly; it answers questions and pushes proactive alerts,
grounded in live Yahoo Fantasy data.

**Stack:** Next.js on Vercel (API routes + cron) · Vercel AI Gateway (LLM routing
with automatic fallback) · [Linq](https://linqapp.com) (iMessage/RCS/SMS API) ·
Yahoo Fantasy Sports API (league data) · Supabase (Postgres + RLS).

This is a backend scaffold, not a finished product — there is no dashboard UI.
Every route is real, working code against the actual third-party APIs (see
"What's verified vs. assumed" below), but onboarding a league today means
calling routes directly or via `curl` until a dashboard is built.

## How it fits together

```
Manager's iPhone
      │  iMessage
      ▼
   Linq  ──────────────► webhook: POST /api/webhooks/linq
      ▲                        │
      │ send reply             ▼
      │                  Supabase (leagues, managers, messages, cached Yahoo data)
      │                        │
      │                        ▼
      └──────────────── Vercel AI Gateway (routes to Claude/GPT/etc, with fallback)


Vercel Cron (vercel.json)
  ├─ /api/cron/sync-leagues     every 15 min  → pulls standings/scoreboard from Yahoo, caches in Supabase
  ├─ /api/cron/lineup-reminders Sundays       → "lineups lock soon" nudge per manager
  └─ /api/cron/weekly-recap     Tuesdays      → AI-written recap per manager

Commissioner
  └─ GET /api/yahoo/authorize?orgId=...&leagueName=...&season=...
        → Yahoo OAuth → /api/yahoo/callback creates the league + stores tokens
```

## Setup

1. **Supabase**: create a project, then run `supabase/migrations/0001_init.sql`
   against it (SQL Editor, or `supabase db push` if you use the CLI). Copy the
   project URL, anon key, and service role key into `.env.local`.
2. **Yahoo**: register an app at [developer.yahoo.com](https://developer.yahoo.com)
   with Fantasy Sports (Read) permission, OAuth2 "Web Application" type. Set
   the redirect URI to `<your-app-url>/api/yahoo/callback` and copy the client
   ID/secret into `.env.local`.
3. **Linq**: sign up at [linqapp.com](https://linqapp.com), generate a
   partner API key at `dashboard.linqapp.com/api-tooling`, and register a
   webhook subscription (Webhook Subscriptions API — see
   [docs.linqapp.com/guides/webhooks/subscriptions](https://docs.linqapp.com/guides/webhooks/subscriptions))
   pointing at `<your-app-url>/api/webhooks/linq` for the `message.received`
   event. Save the webhook signing secret (`whsec_...`) and your sending
   number.
4. **Vercel AI Gateway**: in the Vercel dashboard, AI Gateway → API Keys →
   create a key. (If you deploy this app on Vercel itself, you can skip this
   and rely on OIDC auth instead — see `lib/ai/gateway.ts`.)
5. Copy `.env.example` to `.env.local` and fill in every value.
6. `npm install && npm run dev`

## Connecting a league

There's no UI for this yet, so it's a two-step manual process:

1. Create an `organizations` row for the customer (commissioner/agency) in
   Supabase directly, or via a script — this scaffold doesn't build the
   sign-up flow.
2. Visit `/api/yahoo/authorize?orgId=<that org's id>&leagueName=<hint>&season=<year>`
   in a browser, logged in as the Yahoo account that's a member of the
   league. The callback creates the `leagues` row and stores OAuth tokens.
3. Insert rows into `managers` for each team owner (`league_id`,
   `display_name`, `phone_e164`). This is what maps an inbound iMessage to a
   league/manager — the Linq webhook has no other way to know who's texting.

## What's verified vs. assumed

Everything below was checked against live documentation while building this,
not written from memory — but a few gaps are worth knowing about before you
go live:

- **Linq**: the send endpoint (`POST /api/partner/v3/messages`), request/response
  shape, and webhook signing scheme (Standard Webhooks: `webhook-id` /
  `webhook-timestamp` / `webhook-signature` headers, HMAC-SHA256) are
  confirmed from `docs.linqapp.com`. The exact field names inside a Linq
  "handle" object (`sender_handle` on an inbound message) are **not**
  published — `lib/linq/types.ts` guesses at `phone_number`/`handle`/`value`.
  Send yourself a test message via the Linq sandbox and check the real
  payload before relying on this in production; adjust
  `extractE164FromHandle` if needed.
- **Yahoo Fantasy API**: OAuth endpoints, token exchange, and refresh flow are
  confirmed from `developer.yahoo.com`. The data-fetching resource paths
  (`league/{key}/standings`, `.../scoreboard;week=N`, etc.) match Yahoo's
  long-standing REST resource conventions but weren't re-verified endpoint by
  endpoint. `lib/yahoo/normalize.ts` unpacks Yahoo's notoriously ugly
  numeric-indexed JSON shape defensively — expect to adjust it once you see
  a real response for your league.
- **Vercel AI Gateway**: confirmed directly from `vercel.com/docs/ai-gateway`,
  including the exact `providerOptions.gateway.models` fallback syntax used
  in `lib/ai/gateway.ts`.

## Multi-tenancy model

One `organization` = one paying customer, who can connect multiple `leagues`.
Yahoo OAuth happens once per league (typically the commissioner's login) — the
Fantasy API exposes every team's roster/standings/scoreboard to any authenticated
league member, so you don't need every manager to individually connect Yahoo.
`managers` just need a phone number on file to be reachable over iMessage.

Row Level Security is enabled on every table (`supabase/migrations/0001_init.sql`)
scoped by `org_members`, protecting a future dashboard that queries Supabase
directly with a user's session. Server routes (webhooks, cron, OAuth callback)
use the service role key and intentionally bypass RLS, since none of those
requests carry a Supabase Auth session.

**Known simplification**: a single Linq sending number is shared across every
league on the platform (`LINQ_FROM_NUMBER`), so a manager's phone number alone
determines which league an inbound text belongs to. If the same person is in
two leagues run on this platform, the webhook currently guesses based on which
league they've texted most recently (see the `TODO` in
`app/api/webhooks/linq/route.ts`). Provisioning one Linq number per league, or
adding a "switch league" command, would resolve this properly.

## Extending this

- **Trade/lineup analysis**: `lib/yahoo/client.ts` has `getTeamRoster` but no
  normalizer yet (see the note in `lib/yahoo/normalize.ts`) — that's the next
  thing to build before the assistant can reason about specific players.
- **Commissioner automation**: `managers.is_commissioner` and the org/league
  model support this; no automation logic exists yet.
- **Dashboard**: `lib/supabase/server.ts` is scaffolded for a future
  Supabase-Auth-backed admin UI (league setup, manager management, message
  logs) but no pages exist yet.
