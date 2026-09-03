/**
 * The OpenAI-backed pilot engine.
 *
 * The model is handed the *same tool definitions the browser registers* —
 * sourced from webmcp/schemas.ts — and every call it makes is executed as
 * plain HTTP against the app's own routes with the caller's cookies. It has
 * no server-side imports from lib/proof; if it tries to approve, commit, or
 * declare success, it meets the same 403 the browser's tools would.
 *
 * The shared engine machinery (fixed prompts, tool execution) lives in
 * engine-tools.ts, so the Groq engine hands its model the exact same surface.
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

const RESPONSES_URL = 'https://api.openai.com/v1/responses';

export interface OpenAiOptions {
  apiKey: string;
  /** The working model. Default gpt-5.6-terra. */
  model?: string;
  /** The small model used to parse a goal into typed constraints. Default gpt-5.6-luna. */
  parseModel?: string;
}

interface ResponseItem {
  type?: string;
  role?: string;
  content?: string | { type?: string; text?: string }[];
  call_id?: string;
  name?: string;
  arguments?: string;
  output?: string;
}

interface ResponsesCall {
  ok: boolean;
  outputItems: ResponseItem[];
  text: string;
  error?: string;
}

async function callResponses(
  apiKey: string,
  model: string,
  input: ResponseItem[],
  tools?: unknown[],
  instructions?: string,
): Promise<ResponsesCall> {
  let response: Response;
  try {
    response = await fetch(RESPONSES_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input,
        ...(instructions ? { instructions } : {}),
        ...(tools && tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
      }),
    });
  } catch {
    return { ok: false, outputItems: [], text: '', error: 'could not reach the model provider' };
  }

  if (!response.ok) {
    return {
      ok: false,
      outputItems: [],
      text: '',
      error: `the model provider refused (${response.status})`,
    };
  }

  const body = (await response.json()) as {
    output?: ResponseItem[];
    output_text?: string;
  };

  const items = body.output ?? [];
  const text =
    body.output_text ??
    items
      .flatMap((item) =>
        Array.isArray(item.content)
          ? item.content.map((c) => c.text ?? '')
          : typeof item.content === 'string'
            ? [item.content]
            : [],
      )
      .join('');

  return { ok: true, outputItems: items, text };
}

// ---------------------------------------------------------------------------
// Constraint parsing with the small model, regex as the floor.

/**
 * Parses the goal into typed constraints with the parse model. Any failure —
 * network, refusal, malformed JSON, a bad constraint — falls back to the
 * deterministic parser, so this stage can never be the reason a demo dies.
 */
export async function parseGoalWithModel(
  apiKey: string,
  parseModel: string,
  goal: string,
  current: { checkIn: string; roomId: string; nights: number },
): Promise<{ constraints: unknown[]; source: 'model' | 'scripted' }> {
  const scripted = parseGoal(goal, current);

  try {
    const call = await callResponses(apiKey, parseModel, [
      {
        role: 'user',
        content: `Current reservation: check-in ${current.checkIn}, Room ${current.roomId}, ${current.nights} night(s).\n\nThe human's request: "${goal}"`,
      },
    ], undefined, PARSE_INSTRUCTIONS);
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
 * Runs the model-driven pilot. Yields one PilotStep per meaningful event —
 * a note for the human, one per tool call — until the model stops calling
 * tools, hits the turn ceiling, or the run ends.
 */
export async function* runOpenAiPilot(
  client: PilotClient,
  taskId: string,
  options: OpenAiOptions,
): AsyncGenerator<PilotStep, void, unknown> {
  const model = options.model ?? process.env.PILOT_OPENAI_MODEL ?? 'gpt-5.6-terra';
  const parseModel =
    options.parseModel ?? process.env.PILOT_OPENAI_PARSE_MODEL ?? 'gpt-5.6-luna';

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

  const { constraints, source } = await parseGoalWithModel(
    options.apiKey,
    parseModel,
    task.goal,
    reservation,
  );

  const input: ResponseItem[] = [
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
    const call = await callResponses(options.apiKey, model, input, functionTools(), SYSTEM_PROMPT);

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

    const calls = call.outputItems.filter((item) => item.type === 'function_call');
    if (calls.length === 0) {
      yield {
        note: call.text.trim() || 'I stopped here.',
        outcome: 'needs-you',
      };
      return;
    }

    for (const item of calls) {
      const name = item.name ?? '';
      const { result, step } = await executeTool(client, taskId, name, item.arguments ?? '{}');
      input.push({ type: 'function_call', call_id: item.call_id, name, arguments: item.arguments ?? '{}' });
      input.push({
        type: 'function_call_output',
        call_id: item.call_id,
        output: summarize(result),
      });
      yield step;
    }
  }

  yield {
    note: 'I have done all I can from here — the rest is yours to review.',
    outcome: 'needs-you',
  };
}
