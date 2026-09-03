import { NextResponse } from 'next/server';
import { isSameOrigin, publicOrigin } from '@/lib/http/same-origin';
import type { PilotClient } from '@/lib/pilot/scripted';
import { runScriptedPilot } from '@/lib/pilot/scripted';
import { runOpenAiPilot } from '@/lib/pilot/openai';
import { runGroqPilot } from '@/lib/pilot/groq';
import {
  checkIpRate,
  consumeGroqRun,
  consumeOpenAiRun,
  groqBudgetRemains,
  ipFromRequest,
  openAiBudgetRemains,
} from '@/lib/pilot/rate-limit';

/**
 * POST /api/pilot — the server-side agent.
 *
 * The pilot has **no special privileges**. This route builds an HTTP client
 * from the request's own origin that forwards the caller's cookies, and the
 * engine uses it to call the same route handlers the browser's tools call.
 * Approving, committing, and verifying are not in its vocabulary — it meets
 * the same 403s and validation as any other client.
 *
 * The response is an NDJSON stream: one JSON object per line, each a step the
 * interface shows as it arrives. Engine choice is ours, not the caller's:
 * OpenAI when its key and budget allow, then Groq (gpt-oss-20b), and the
 * deterministic scripted pilot otherwise — and either model engine degrades
 * to the playbook on provider failure, so the demo never dies on a rate
 * limit.
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'cross-origin requests are refused' }, { status: 403 });
  }

  if (!checkIpRate(ipFromRequest(request))) {
    return NextResponse.json(
      { error: 'the pilot is busy — try again in a moment' },
      { status: 429 },
    );
  }

  let taskId = '';
  try {
    const body = (await request.json()) as { taskId?: unknown };
    if (typeof body.taskId === 'string') taskId = body.taskId;
  } catch {
    // fall through to the validation below
  }
  if (!/^task_[0-9]+$/.test(taskId)) {
    return NextResponse.json(
      { error: 'taskId is required, like "task_3"' },
      { status: 400 },
    );
  }

  const openAiKey = process.env.OPENAI_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;

  let engine: 'openai' | 'groq' | 'scripted';
  if (openAiKey && openAiBudgetRemains()) {
    engine = 'openai';
    consumeOpenAiRun();
  } else if (groqKey && groqBudgetRemains()) {
    engine = 'groq';
    consumeGroqRun();
  } else {
    engine = 'scripted';
  }

  const client = forwardClient(request);
  const run =
    engine === 'openai'
      ? runOpenAiPilot(client, taskId, { apiKey: openAiKey! })
      : engine === 'groq'
        ? runGroqPilot(client, taskId, { apiKey: groqKey! })
        : runScriptedPilot(client, taskId);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (line: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      };

      send({ engine, taskId });
      try {
        for await (const step of run) {
          send({ engine, ...step });
        }
      } catch {
        send({
          engine,
          note: 'Something interrupted me. Nothing has been changed without you.',
          outcome: 'error',
        });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

/**
 * An HTTP client bound to the caller's own session: same origin, same
 * cookies, no internal imports. The pilot genuinely is just another client.
 */
function forwardClient(request: Request): PilotClient {
  // The origin the caller actually arrived on — behind a proxy, request.url
  // is the internal address, so self-calls would aim at a host nothing can
  // reach. publicOrigin() resolves to the public address the browser used.
  const origin = publicOrigin(request);
  const cookie = request.headers.get('cookie') ?? '';

  async function call(path: string, init?: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${origin}${path}`, {
        ...init,
        headers: {
          ...(init?.body ? { 'content-type': 'application/json' } : {}),
          ...(cookie ? { cookie } : {}),
        },
        redirect: 'manual',
      });
    } catch {
      return { error: 'the site could not be reached' };
    }

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // Non-JSON error pages land here; fall through to the status line.
    }

    if (!response.ok) {
      const message =
        body !== null &&
        typeof body === 'object' &&
        'error' in body &&
        typeof (body as { error: unknown }).error === 'string'
          ? (body as { error: string }).error
          : `the site refused this call (${response.status})`;
      return { error: message, httpStatus: response.status };
    }
    return body;
  }

  return {
    get: (path) => call(path),
    post: (path, body) => call(path, { method: 'POST', body: JSON.stringify(body) }),
  };
}
