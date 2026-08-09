import type { LinqSendMessageRequest, LinqSendMessageResponse } from './types';

const LINQ_API_BASE = 'https://api.linqapp.com/api/partner/v3';

class LinqApiError extends Error {
  constructor(public status: number, public body: string) {
    super(`Linq API request failed (${status}): ${body}`);
  }
}

function requireApiKey(): string {
  const key = process.env.LINQ_API_KEY;
  if (!key) throw new Error('Missing LINQ_API_KEY env var.');
  return key;
}

/**
 * Send a plain-text iMessage/RCS/SMS via Linq. Linq auto-selects the
 * sending line and the protocol (iMessage vs RCS vs SMS fallback) unless
 * `from` is provided.
 */
export async function sendTextMessage(
  toE164: string,
  text: string
): Promise<LinqSendMessageResponse> {
  const body: LinqSendMessageRequest = {
    to: [toE164],
    message: { parts: [{ type: 'text', value: text }] },
  };

  if (process.env.LINQ_FROM_NUMBER) {
    body.from = process.env.LINQ_FROM_NUMBER;
  }

  const res = await fetch(`${LINQ_API_BASE}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requireApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new LinqApiError(res.status, raw);
  }

  return JSON.parse(raw) as LinqSendMessageResponse;
}

/**
 * Fan-out helper for proactive sends (weekly recaps, lineup reminders)
 * where a partial failure for one manager shouldn't block the rest.
 */
export async function sendTextMessageBatch(
  recipients: { toE164: string; text: string }[]
): Promise<{ toE164: string; ok: boolean; error?: string }[]> {
  return Promise.all(
    recipients.map(async ({ toE164, text }) => {
      try {
        await sendTextMessage(toE164, text);
        return { toE164, ok: true };
      } catch (err) {
        return { toE164, ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    })
  );
}
