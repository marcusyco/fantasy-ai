/**
 * Hand-written types matching supabase/migrations/0001_init.sql.
 *
 * Once the project is linked to a real Supabase instance, regenerate this
 * file for full accuracy:
 *
 *   npx supabase gen types typescript --project-id <ref> > types/database.ts
 *
 * `Relationships: []` on every table and empty `Views`/`Functions` below
 * aren't optional boilerplate — @supabase/postgrest-js's `GenericSchema`
 * constraint requires them, and without them TS silently widens every
 * query result to `never` instead of raising a helpful error.
 */

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: { id: string; name: string; created_at: string };
        Insert: { id?: string; name: string; created_at?: string };
        Update: Partial<Database['public']['Tables']['organizations']['Insert']>;
        Relationships: [];
      };
      org_members: {
        Row: { id: string; org_id: string; user_id: string; role: string; created_at: string };
        Insert: {
          id?: string;
          org_id: string;
          user_id: string;
          role?: string;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['org_members']['Insert']>;
        Relationships: [];
      };
      leagues: {
        Row: {
          id: string;
          org_id: string;
          name: string;
          sport: string;
          season: number;
          yahoo_league_key: string | null;
          timezone: string;
          context_markdown: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          name: string;
          sport?: string;
          season: number;
          yahoo_league_key?: string | null;
          timezone?: string;
          context_markdown?: string | null;
        };
        Update: Partial<Database['public']['Tables']['leagues']['Insert']>;
        Relationships: [];
      };
      yahoo_connections: {
        Row: {
          id: string;
          league_id: string;
          yahoo_guid: string | null;
          access_token: string;
          refresh_token: string;
          expires_at: string;
          scope: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          league_id: string;
          yahoo_guid?: string | null;
          access_token: string;
          refresh_token: string;
          expires_at: string;
          scope?: string;
        };
        Update: Partial<Database['public']['Tables']['yahoo_connections']['Insert']>;
        Relationships: [];
      };
      managers: {
        Row: {
          id: string;
          league_id: string;
          yahoo_team_key: string | null;
          display_name: string;
          phone_e164: string;
          is_commissioner: boolean;
          timezone: string;
          opted_in_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          league_id: string;
          yahoo_team_key?: string | null;
          display_name: string;
          phone_e164: string;
          is_commissioner?: boolean;
          timezone?: string;
          opted_in_at?: string | null;
        };
        Update: Partial<Database['public']['Tables']['managers']['Insert']>;
        Relationships: [];
      };
      linq_chats: {
        Row: { id: string; manager_id: string; linq_chat_id: string; created_at: string };
        Insert: { id?: string; manager_id: string; linq_chat_id: string; created_at?: string };
        Update: Partial<Database['public']['Tables']['linq_chats']['Insert']>;
        Relationships: [];
      };
      messages: {
        Row: {
          id: string;
          league_id: string;
          manager_id: string | null;
          direction: 'inbound' | 'outbound';
          body: string;
          linq_message_id: string | null;
          linq_event_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          league_id: string;
          manager_id?: string | null;
          direction: 'inbound' | 'outbound';
          body: string;
          linq_message_id?: string | null;
          linq_event_id?: string | null;
        };
        Update: Partial<Database['public']['Tables']['messages']['Insert']>;
        Relationships: [];
      };
      league_data_cache: {
        Row: {
          id: string;
          league_id: string;
          data_type: 'standings' | 'scoreboard' | 'rosters' | 'transactions';
          week: number | null;
          payload: unknown;
          synced_at: string;
        };
        Insert: {
          id?: string;
          league_id: string;
          data_type: 'standings' | 'scoreboard' | 'rosters' | 'transactions';
          week?: number | null;
          payload: unknown;
          synced_at?: string;
        };
        Update: Partial<Database['public']['Tables']['league_data_cache']['Insert']>;
        Relationships: [];
      };
      scheduled_sends: {
        Row: {
          id: string;
          league_id: string;
          manager_id: string | null;
          kind: 'lineup_reminder' | 'weekly_recap' | 'injury_alert';
          week: number;
          sent_at: string;
        };
        Insert: {
          id?: string;
          league_id: string;
          manager_id?: string | null;
          kind: 'lineup_reminder' | 'weekly_recap' | 'injury_alert';
          week: number;
          sent_at?: string;
        };
        Update: Partial<Database['public']['Tables']['scheduled_sends']['Insert']>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
}
