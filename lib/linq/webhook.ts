import { createHmac, timingSafeEqual } from 'crypto';
import type { LinqMessageEvent } from './types';

/**
 * Linq signs webhooks per the Standard Webhooks spec
 * (https://www.standardwebhooks.com), the same scheme used by Svix, Resend,
 * etc:
 *
 *   signed_content = `${webhookId}.${webhookTimestamp}.${rawBody}`
 *   signature      = base64(HMAC-SHA256(secretBytes, signed_content))
 *
 * The secret is provided as `whsec_<base64>`; strip the prefix and
 * base64-decode before using it as the HMAC key. The `webhook-signature`
 * header can contain multiple space-delimited `v1,<sig>` values (secret
 * rotation) — a match against any of them is valid.
 */

const TOLERANCE_SECONDS = 5 * 60;

export class LinqWebhookVerificationError extends Error {}

export interface LinqWebhookHeaders {
  'webhook-id': string;
  'webhook-timestamp': string;
  'webhook-signature': string;
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verifies signature + timestamp freshness. Throws
 * `LinqWebhookVerificationError` on any failure — callers should catch and
 * respond 401, never process an unverified payload.
 */
export function verifyLinqWebhookSignature(
  rawBody: string,
  headers: LinqWebhookHeaders,
  secret = process.env.LINQ_WEBHOOK_SECRET
): void {
  if (!secret) {
    throw new LinqWebhookVerificationError('Missing LINQ_WEBHOOK_SECRET env var.');
  }

  const id = headers['webhook-id'];
  const timestamp = headers['webhook-timestamp'];
  const signatureHeader = headers['webhook-signature'];

  if (!id || !timestamp || !signatureHeader) {
    throw new LinqWebhookVerificationError('Missing one or more webhook-* headers.');
  }

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) {
    throw new LinqWebhookVerificationError('Invalid webhook-timestamp header.');
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > TOLERANCE_SECONDS) {
    throw new LinqWebhookVerificationError('Webhook timestamp outside tolerance window.');
  }

  if (!secret.startsWith('whsec_')) {
    throw new LinqWebhookVerificationError('LINQ_WEBHOOK_SECRET must start with "whsec_".');
  }
  const secretBytes = Buffer.from(secret.slice('whsec_'.length), 'base64');

  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const expectedSignature = createHmac('sha256', secretBytes)
    .update(signedContent)
    .digest('base64');

  const candidates = signatureHeader
    .split(' ')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.split(',')[1]) // strip the "v1," version prefix
    .filter((sig): sig is string => Boolean(sig));

  const matched = candidates.some((sig) => timingSafeEqualStrings(sig, expectedSignature));
  if (!matched) {
    throw new LinqWebhookVerificationError('Signature mismatch.');
  }
}

export function parseLinqMessageEvent(rawBody: string): LinqMessageEvent {
  return JSON.parse(rawBody) as LinqMessageEvent;
}
