import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  verifyLinqWebhookSignature,
  parseLinqMessageEvent,
  LinqWebhookVerificationError,
} from '@/lib/linq/webhook';
import { extractE164FromHandle } from '@/lib/linq/types';
import { sendTextMessage } from '@/lib/linq/client';
import { generateAssistantReply } from '@/lib/ai/assistant';

export const runtime = 'nodejs'; // signature verification uses node:crypto
export const maxDuration = 30; // AI generation + Linq round-trip can take a few seconds

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

  await supabase.from('messages').insert({
    league_id: manager.league_id,
    manager_id: manager.id,
    direction: 'inbound',
    body: textPart.value,
    linq_message_id: event.data.id,
    linq_event_id: event.event_id,
  });

  let replyText: string;
  try {
    replyText = await generateAssistantReply({
      leagueId: manager.league_id,
      managerId: manager.id,
      incomingText: textPart.value,
    });
  } catch (err) {
    console.error('Assistant generation failed.', err);
    replyText = "Sorry, I hit a snag pulling that up — give me a minute and try again.";
  }

  const sendResult = await sendTextMessage(phone, replyText);

  await supabase.from('messages').insert({
    league_id: manager.league_id,
    manager_id: manager.id,
    direction: 'outbound',
    body: replyText,
    linq_message_id: sendResult.message_id,
  });

  return NextResponse.json({ ok: true });
}
