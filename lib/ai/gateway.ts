import { streamText, type CoreMessage } from 'ai';

/**
 * Thin wrapper around Vercel AI Gateway routing, confirmed against
 * https://vercel.com/docs/ai-gateway (getting-started, model-fallbacks,
 * provider-options) at time of writing.
 *
 * Auth: set AI_GATEWAY_API_KEY locally (Vercel dashboard → AI Gateway →
 * API Keys). When this app is deployed on Vercel, the AI SDK can instead
 * authenticate automatically via OIDC — no key needed in that case. Either
 * way, `model` is passed as a plain "provider/model" string; no explicit
 * gateway client/import is required for the AI SDK path.
 */

const PRIMARY_MODEL = process.env.AI_GATEWAY_PRIMARY_MODEL ?? 'anthropic/claude-opus-5';
const FALLBACK_MODEL = process.env.AI_GATEWAY_FALLBACK_MODEL ?? 'openai/gpt-5.6-sol';

export interface RouteChatOptions {
  system: string;
  messages: CoreMessage[];
  maxOutputTokens?: number;
}

/**
 * Streams a chat completion, routed through AI Gateway with automatic
 * fallback to a second model/provider if the primary is unavailable.
 * Returns the AI SDK `streamText` result so callers can either pipe it to
 * a UI stream response or collect the full text (see `collectText`).
 */
export function routeChat({ system, messages, maxOutputTokens = 2048 }: RouteChatOptions) {
  return streamText({
    model: PRIMARY_MODEL,
    system,
    messages,
    maxOutputTokens,
    providerOptions: {
      gateway: {
        // Try a different provider/model family entirely if the primary
        // is down — cheap insurance for a product that pages people via
        // iMessage and can't just show a "try again" spinner.
        models: [FALLBACK_MODEL],
      },
      // Gemini 3.x "thinking" models spend part of maxOutputTokens on
      // invisible reasoning tokens before writing the visible reply — for
      // a short-texting use case that was eating the whole budget and
      // truncating replies mid-sentence (finishReason: "length"). `low`
      // leaves the budget for the actual answer instead.
      google: {
        thinkingConfig: { thinkingLevel: 'low' },
      },
    },
  });
}

/** Convenience for server contexts (webhooks, cron) that need plain text, not a stream. */
export async function collectText(options: RouteChatOptions): Promise<string> {
  const result = routeChat(options);
  return result.text;
}
