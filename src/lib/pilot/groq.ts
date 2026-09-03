/**
 * The Groq-backed pilot engine — gpt-oss-20b as the working agent.
 *
 * Same contract as the OpenAI engine, same fixed prompt, same tool surface:
 * the model is handed the tool definitions the browser registers, and every
 * call it makes is executed as plain HTTP against the app's own routes with
 * the caller's cookies. It cannot approve, commit, or declare success — the
 * tools do not exist, and the routes enforce the rest.
 *
 * It is an *engine*, never a verifier: the checker stays deterministic and
 * final (see lib/proof/verifier.ts). Any provider failure degrades to the
 * scripted playbook, so the demo never dies on a rate limit.
 */

import {
  SYSTEM_PROMPT,
  PARSE_INSTRUCTIONS,
  executeTool,
  functionTools,
  summarize,
  MAX_TURNS,
} from './engine-tools';
import { runScriptedPilot, parseGoal, type PilotClient, type PilotStep } from './scripted';

const CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';

export interface GroqOptions {
  apiKey: string;
  /** Default: openai/gpt-oss-20b on Groq. */
  model?: string;
}

interface ToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

interface ChatCall {
  ok: boolean;
  message: ChatMessage | null;
  text: string;
  toolCalls: ToolCall[];
  error?: string;
}

async function callChat(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  tools?: unknown[],
  system?: string,
): Promise<ChatCall> {
  const allMessages: ChatMessage[] = system ? [{ role: 'system', content: system }, ...messages] : messages;

  let response: Response;
  try {
    response = await fetch(CHAT_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: allMessages,
        // gpt-oss reasons before answering; keep the reasoning out of the
        // notes the interface shows.
        reasoning_format: 'hidden',
        ...(tools && tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
      }),
    });
  } catch {
    return { ok: false, message: null, text: '', toolCalls: [], error: 'could not reach the model provider' };
  }

  if (!response.ok) {
    return {
      ok: false,
      message: null,
      text: '',
      toolCalls: [],
      error: `the model provider refused (${response.status})`,
    };
  }

  const body = (await response.json()) as {
    choices?: { message?: ChatMessage }[];
  };
  const message = body.choices?.[0]?.message ?? null;
  return {
    ok: true,
    message,
    text: message?.content ?? '',
    toolCalls: message?.tool_calls ?? [],
  };
}

/** Nest the shared flat tool specs the way chat-completions APIs expect. */
function chatTools(): unknown[] {
  return functionTools().map((tool) => {
    const flat = tool as { type: string; name: string; description: string; parameters: unknown };
    return {
      type: 'function',
      function: {
        name: flat.name,
        description: flat.description,
        parameters: flat.parameters,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Constraint parsing with the same model, regex as the floor — as everywhere
// else, any failure falls back to the deterministic parser.

async function parseGoalWithGroq(
  apiKey: string,
  model: string,
  goal: string,
  current: { checkIn: string; roomId: string; nights: number },
): Promise<{ constraints: unknown[]; source: 'model' | 'scripted' }> {
  const scripted = parseGoal(goal, current);

  try {
    const call = await callChat(apiKey, model, [
      {
        role: 'user',
        content: `${PARSE_INSTRUCTIONS}\n\nCurrent reservation: check-in ${current.checkIn}, Room ${current.roomId}, ${current.nights} night(s).\n\nThe human's request: "${goal}"`,
      },
    ]);
    if (!call.ok || !call.text) return { constraints: scripted.constraints, source: 'scripted' };

    const match = call.text.match(/\{[\s\S]*\}/);
    if (!match) return { constraints: scripted.constraints, source: 'scripted' };
    const parsed = JSON.parse(match[0]) as { constraints?: unknown[] };
    if (!Array.isArray(parsed.constraints)) {
      return { constraints: scripted.constraints, source: 'scripted' };
    }
    return { constraints: parsed.constraints, source: 'model' };
  } catch {
    return { constraints: scripted.constraints, source: 'scripted' };
  }
}

// ---------------------------------------------------------------------------
// The loop

/**
 * Runs the model-driven pilot over Groq's chat-completions API. Yields one
 * PilotStep per meaningful event, exactly like the OpenAI engine, until the
 * model stops calling tools, hits the turn ceiling, or the run ends.
 */
export async function* runGroqPilot(
  client: PilotClient,
  taskId: string,
  options: GroqOptions,
): AsyncGenerator<PilotStep, void, unknown> {
  const model = options.model ?? process.env.PILOT_GROQ_MODEL ?? 'openai/gpt-oss-20b';

  const taskResponse = (await client.get(`/api/tasks/${taskId}`)) as {
    task?: { state: string; revision: number; goal: string };
    reservation?: { reservationId: string; checkIn: string; roomId: string; nights: number; guestCount?: number } | null;
    error?: string;
  };

  const task = taskResponse.task;
  if (!task) {
    yield { note: 'I could not find that task.', outcome: 'error', detail: taskResponse };
    return;
  }
  const reservation = taskResponse.reservation;
  if (!reservation) {
    yield { note: 'There is no reservation in this workspace to work on.', outcome: 'error' };
    return;
  }

  const { constraints, source } = await parseGoalWithGroq(
    options.apiKey,
    model,
    task.goal,
    reservation,
  );

  const messages: ChatMessage[] = [
    {
      role: 'user',
      content: `Work on task ${taskId}.

The human's goal: "${task.goal}"

The task is currently in state ${task.state} at revision ${task.revision}.
Current reservation: ${reservation.reservationId} — check-in ${reservation.checkIn}, Room ${reservation.roomId}, ${reservation.nights} night(s), ${reservation.guestCount ?? 1} guest(s).

A parser read the goal as these typed constraints (${source === 'model' ? 'parsed by the site' : 'parsed deterministically'}):
${JSON.stringify(constraints)}

Use them as a starting point: read the task to confirm, correct them with set_goal or refine_constraints if they are wrong, then quote and stage the change for the human. Stop once a change is staged.`,
    },
  ];

  yield {
    note: `I read the task and understood it as ${JSON.stringify(constraints)}.`,
    outcome: 'ok',
  };

  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    const call = await callChat(options.apiKey, model, messages, chatTools(), SYSTEM_PROMPT);

    if (!call.ok) {
      // A provider failure before any work is done degrades to the scripted
      // playbook, so a judge never meets a dead demo.
      if (turn === 0) {
        yield {
          note: 'The model provider did not answer, so I continued with the built-in playbook.',
          outcome: 'error',
        };
        yield* runScriptedPilot(client, taskId);
        return;
      }
      yield { note: `I could not keep going: ${call.error}.`, outcome: 'error' };
      return;
    }

    if (call.toolCalls.length === 0) {
      yield {
        note: call.text.trim() || 'I stopped here.',
        outcome: 'needs-you',
      };
      return;
    }

    // The assistant turn must be echoed back verbatim, tool calls included,
    // before the tool results — the chat-completions contract.
    messages.push({
      role: 'assistant',
      content: call.text || null,
      tool_calls: call.toolCalls,
    });

    for (const toolCall of call.toolCalls) {
      const name = toolCall.function?.name ?? '';
      const rawArgs = toolCall.function?.arguments ?? '{}';
      const { result, step } = await executeTool(client, taskId, name, rawArgs);
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id ?? '',
        content: summarize(result),
      });
      yield step;
    }
  }

  yield {
    note: 'I have done all I can from here — the rest is yours to review.',
    outcome: 'needs-you',
  };
}
