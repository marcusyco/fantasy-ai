import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  verifyLinqWebhookSignature,
  parseLinqMessageEvent,
  LinqWebhookVerificationError,
} from '@/lib/linq/webhook';
import { extractE164FromHandle } from '@/lib/linq/types';
import { sendTextMessage, sendMessageToChat } from '@/lib/linq/client';
import { isBotMentioned } from '@/lib/linq/mentions';
import { generateAssistantReply } from '@/lib/ai/assistant';

export const runtime = 'nodejs'; // signature verification uses node:crypto
export const maxDuration = 30; // AI generation + Linq round-trip can take a few seconds

const THINKING_ACK_DELAY_MS = 6000;
const THINKING_ACK_MESSAGES = [
  "Good question — let me dig into that for you.",
  "Good question, let me find the right answer for you.",
  "Hang tight, checking the latest before I answer.",
  "One sec, pulling up the numbers.",
  "Give me a sec to look into that.",
  "Let me check on that real quick.",
  "Digging in — back in a sec.",
];

function randomThinkingAck(): string {
  return THINKING_ACK_MESSAGES[Math.floor(Math.random() * THINKING_ACK_MESSAGES.length)]!;
}

/**
 * Inbound iMessage/RCS/SMS handler. Register this URL as a webhook
 * subscription for `message.received` in the Linq dashboard (Webhook
 * Subscriptions API) — see docs.linqapp.com/guides/webhooks/subscriptions.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  try {
    verifyLinqWebhookSignature(rawBody, {
      'webhook-id': request.headers.get('webhook-id') ?? '',
      'webhook-timestamp': request.headers.get('webhook-timestamp') ?? '',
      'webhook-signature': request.headers.get('webhook-signature') ?? '',
    });
  } catch (err) {
    if (err instanceof LinqWebhookVerificationError) {
      console.warn('Rejected Linq webhook: signature verification failed.', err.message);
      return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
    }
    throw err;
  }

  const event = parseLinqMessageEvent(rawBody);

  // Only inbound text messages trigger the assistant. Ack everything else
  // (delivery/read receipts, reactions, our own sent-message echoes) so
  // Linq doesn't retry them as failed deliveries.
  if (event.event_type !== 'message.received' || event.data.direction !== 'inbound') {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const supabase = createAdminClient();

  // Idempotency: Linq (like most webhook providers) may redeliver on a
  // slow response. Bail out early if we've already recorded this event.
  const { data: existing } = await supabase
    .from('messages')
    .select('id')
    .eq('linq_event_id', event.event_id)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const phone = extractE164FromHandle(event.data.sender_handle);
  const textPart = event.data.parts.find((part) => part.type === 'text');

  if (!phone || !textPart) {
    console.error('Linq webhook missing sender phone or text part.', {
      eventId: event.event_id,
    });
    // Ack anyway — retrying won't fix a payload shape we can't parse, and
    // we don't want Linq to keep hammering this endpoint.
    return NextResponse.json({ ok: true, unparsed: true });
  }

  // A phone number is unique per (league_id, phone_e164), not globally —
  // the same person can be in more than one league run on this platform.
  // TODO: once leagues share a single Linq line, disambiguate properly
  // (e.g. a "switch to league X" command, or provision one Linq number
  // per league so the `to` address alone determines the league). For now,
  // fall back to whichever of the manager's leagues they've texted most
  // recently.
  const { data: candidates } = await supabase
    .from('managers')
    .select('id, league_id, display_name')
    .eq('phone_e164', phone);

  if (!candidates || candidates.length === 0) {
    // v2: self-serve onboarding — let an unrecognized number text in, ask
    // for their name, and auto-create a manager row (gated by an invite
    // code so strangers can't join a league just by knowing the number).
    // For now managers are added manually by the commissioner ahead of time.
    await sendTextMessage(
      phone,
      "Hey! I don't have this number linked to a league yet — ask your commissioner to add you in the dashboard."
    );
    return NextResponse.json({ ok: true, unmatched: true });
  }

  let manager = candidates[0]!;
  if (candidates.length > 1) {
    const { data: lastActive } = await supabase
      .from('messages')
      .select('manager_id, created_at')
      .in('manager_id', candidates.map((c) => c.id))
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    manager = candidates.find((c) => c.id === lastActive?.manager_id) ?? manager;
  }

  // A chat thread is just "a Linq conversation" — could be this manager's
  // 1:1 with the bot, the whole league's group text, or a couple managers
  // hashing out a trade in their own group. Register it the first time we
  // see its `chat.id`; every message we see afterward reuses this row.
  const { data: chatThread, error: chatThreadError } = await supabase
    .from('chat_threads')
    .upsert(
      { league_id: manager.league_id, linq_chat_id: event.data.chat.id, is_group: event.data.chat.is_group },
      { onConflict: 'linq_chat_id' }
    )
    .select('id, is_group')
    .single();

  if (chatThreadError || !chatThread) {
    console.error('Failed to upsert chat thread.', chatThreadError);
    return NextResponse.json({ error: 'failed to record chat thread' }, { status: 500 });
  }

  await supabase.from('messages').insert({
    league_id: manager.league_id,
    manager_id: manager.id,
    chat_thread_id: chatThread.id,
    direction: 'inbound',
    body: textPart.value,
    linq_message_id: event.data.id,
    linq_event_id: event.event_id,
  });

  // In a group thread, only respond when directly addressed — otherwise
  // the bot would reply to every message in a busy league-wide group text.
  // The inbound message is still logged above so it has context for later.
  if (chatThread.is_group && !isBotMentioned(textPart.value)) {
    return NextResponse.json({ ok: true, groupMessageIgnored: true });
  }

  // If the real answer takes a while (e.g. search-grounded lookups), send a
  // quick "still working on it" ack so the manager isn't left staring at a
  // silent thread. Cleared as soon as the real reply is ready, so fast
  // replies never trigger it.
  const thinkingAckText = randomThinkingAck();
  const thinkingAckTimer = setTimeout(() => {
    sendMessageToChat(event.data.chat.id, thinkingAckText)
      .then((sent) =>
        supabase.from('messages').insert({
          league_id: manager.league_id,
          manager_id: manager.id,
          chat_thread_id: chatThread.id,
          direction: 'outbound',
          body: thinkingAckText,
          linq_message_id: sent.id,
        })
      )
      .catch((err) => console.error('Failed to send "thinking" ack message.', err));
  }, THINKING_ACK_DELAY_MS);

  let replyText: string;
  try {
    replyText = await generateAssistantReply({
      leagueId: manager.league_id,
      managerId: manager.id,
      chatThreadId: chatThread.id,
      isGroup: chatThread.is_group,
      incomingText: textPart.value,
    });
  } catch (err) {
    console.error('Assistant generation failed.', err);
    replyText = "Sorry, I hit a snag pulling that up — give me a minute and try again.";
  } finally {
    clearTimeout(thinkingAckTimer);
  }

  // Linq rejects an empty text part outright — guard against the model
  // finishing with nothing to say (seen with search-grounded responses)
  // rather than letting that 400 kill the whole request silently.
  if (!replyText.trim()) {
    console.error('Assistant generated an empty reply; sending fallback instead.');
    replyText = "I looked into that but didn't come up with a clear answer — try rephrasing?";
  }

  // Reply into the same chat (not just the sender's phone) so group replies
  // land back in the shared thread instead of opening a side 1:1.
  const sendResult = await sendMessageToChat(event.data.chat.id, replyText);

  await supabase.from('messages').insert({
    league_id: manager.league_id,
    manager_id: manager.id,
    chat_thread_id: chatThread.id,
    direction: 'outbound',
    body: replyText,
    linq_message_id: sendResult.id,
  });

  return NextResponse.json({ ok: true });
}
