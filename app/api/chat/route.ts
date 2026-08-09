import { NextRequest } from 'next/server';
import type { CoreMessage } from 'ai';
import { routeChat } from '@/lib/ai/gateway';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * Browser-testable version of the assistant (no Yahoo/Supabase context,
 * no Linq round-trip) — useful for confirming the AI Gateway wiring and
 * fallback routing work before plugging in the iMessage side. Not linked
 * from any UI in this scaffold; hit it directly, e.g.:
 *
 *   curl -N -X POST http://localhost:3000/api/chat \
 *     -H 'Content-Type: application/json' \
 *     -d '{"messages":[{"role":"user","content":"Who should I start this week?"}]}'
 */
export async function POST(request: NextRequest) {
  const { messages } = (await request.json()) as { messages: CoreMessage[] };

  const result = routeChat({
    system:
      'You are a fantasy football assistant. This is a wiring test with no real league data attached — say so if asked about specific players or scores.',
    messages,
  });

  return result.toUIMessageStreamResponse();
}
