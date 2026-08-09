/**
 * Types for the Linq Partner API (iMessage/RCS/SMS).
 *
 * Sourced from https://docs.linqapp.com (guides/messaging/sending-messages,
 * guides/webhooks, guides/webhooks/events) as of writing. Linq's docs are
 * evolving — the "handle" object shape in particular is not fully
 * documented publicly, so `LinqHandle` is intentionally loose. Before
 * going live, send yourself a real webhook via the Linq sandbox
 * (dashboard.linqapp.com/api-tooling) and confirm `extractE164FromHandle`
 * below against the actual payload.
 */

export type LinqMessagePartType = 'text' | 'image' | 'video' | 'audio' | 'reaction';

export interface LinqMessagePart {
  type: LinqMessagePartType;
  value: string;
}

/** Sender/recipient identity object attached to chats and messages. */
export interface LinqHandle {
  // Confirmed field names are not published; these are the most likely
  // candidates based on Linq's E.164-first messaging model. Widened with
  // an index signature so unexpected fields don't break parsing.
  phone_number?: string;
  handle?: string;
  value?: string;
  [key: string]: unknown;
}

export interface LinqChatRef {
  id: string;
  is_group: boolean;
  owner_handle?: LinqHandle;
  health_status?: unknown;
}

export type LinqMessageEventType =
  | 'message.received'
  | 'message.sent'
  | 'message.delivered'
  | 'message.read'
  | 'message.failed'
  | 'message.edited';

export interface LinqMessageEvent {
  api_version: string;
  webhook_version: string;
  event_type: LinqMessageEventType;
  event_id: string;
  created_at: string;
  trace_id: string;
  partner_id: string;
  data: {
    chat: LinqChatRef;
    id: string;
    direction: 'inbound' | 'outbound';
    sender_handle?: LinqHandle;
    parts: LinqMessagePart[];
    sent_at: string;
    service: 'iMessage' | 'RCS' | 'SMS';
  };
}

export interface LinqSendMessageRequest {
  to: string[]; // E.164
  message: { parts: LinqMessagePart[] };
  from?: string; // omit to let Linq auto-select the best line
}

export interface LinqSendMessageResponse {
  from: string;
  chat_id: string;
  created_new_chat: boolean;
  from_selection?: { reason: 'reused_active_chat' | 'new_best_number' | 'failover_flagged' };
  message_id: string;
}

/** Best-effort E.164 extraction from a Linq handle object. */
export function extractE164FromHandle(handle: LinqHandle | undefined): string | null {
  if (!handle) return null;
  const candidate = handle.phone_number ?? handle.handle ?? handle.value;
  if (typeof candidate === 'string' && candidate.startsWith('+')) {
    return candidate;
  }
  return null;
}
