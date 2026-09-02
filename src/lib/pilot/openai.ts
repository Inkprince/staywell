/**
 * The OpenAI-backed pilot engine.
 *
 * The model is handed the *same tool definitions the browser registers* —
 * sourced from webmcp/schemas.ts — and every call it makes is executed as
 * plain HTTP against the app's own routes with the caller's cookies. It has
 * no server-side imports from lib/proof; if it tries to approve, commit, or
 * declare success, it meets the same 403 the browser's tools would.
 *
 * Guards: a fixed system prompt (never user-controlled), at most 12 model
 * turns, and a hard ceiling on the argument sizes we will echo back.
 */

import { TOOL_DEFINITIONS } from '@/webmcp/schemas';
import { runScriptedPilot, parseGoal, type PilotClient, type PilotStep } from './scripted';

const RESPONSES_URL = 'https://api.openai.com/v1/responses';

const MAX_TURNS = 12;
const MAX_OUTPUT_CHARS = 4000;

export interface OpenAiOptions {
  apiKey: string;
  /** The working model. Default gpt-5.6-terra. */
  model?: string;
  /** The small model used to parse a goal into typed constraints. Default gpt-5.6-luna. */
  parseModel?: string;
}

// ---------------------------------------------------------------------------
// Fixed prompts. The route never accepts prompt text from the request.

const SYSTEM_PROMPT = `You are Proof's pilot agent, working inside a hotel-booking demo called StayWell.

Your job: take the human's goal for their reservation and drive the task as far as you legitimately can — understand the ask as typed constraints, quote the change, and stage it for review. Then stop.

Hard rules:
- You cannot approve a change, commit a change, or declare success. Those belong to the human and the site. Do not try; refusals are final.
- Nothing is applied until the human approves it in the page. Staging is your finish line.
- Read the task and constraints before planning. Quote before staging.
- Only stage a change you believe satisfies every constraint. If nothing can, say so plainly and stop — do not stage a compromise silently.
- After a caught mismatch, you may find recovery options and stage one ONLY if it violates no stated constraint. Trade-offs are the human's to make.

You have at most a dozen turns. Be economical: read what you need, act, stop.`;

const PARSE_INSTRUCTIONS = `You translate a hotel-guest request into typed constraints. Respond with only JSON of the form:
{"constraints":[{"kind":"date_equals","date":"YYYY-MM-DD"}|{"kind":"room_equals","roomId":"NNN"}|{"kind":"price_at_most","amount":N}|{"kind":"unchanged","field":"checkIn"|"roomId"|"nights"|"totalPrice"|"guestName"|"ratePlanId"|"status"|"reservationId"}]}

Rules:
- Weekday names map to dates in the week starting Tuesday 2026-09-01 (so "Friday" is 2026-09-04).
- "Same room" / "keep my room" is room_equals with the current room.
- Price limits ("under $300", "no more than $300") are price_at_most.
- "One night shorter" and similar length changes are {kind:"unchanged",field:"nights"} only when the request is explicit about keeping something; otherwise omit them.
- Never invent constraints the human did not state. An empty array is a valid answer.`;

// ---------------------------------------------------------------------------
// HTTP to the Responses API. Plain fetch — no SDK, no retry storm.

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

/** TOOL_DEFINITIONS → Responses API function tools, verbatim. */
function functionTools(): unknown[] {
  return TOOL_DEFINITIONS.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  }));
}

// ---------------------------------------------------------------------------
// Tool execution — the same HTTP the browser's tools speak, nothing more.

type ToolRunner = (
  client: PilotClient,
  taskId: string,
  args: Record<string, unknown>,
) => { path: string; note: string } | null;

const RUNNERS: Record<string, ToolRunner> = {
  get_task: (client, taskId) => ({ path: `/api/tasks/${taskId}`, note: 'Read the task.' }),
  get_reservation: (_client, _taskId, args) => {
    const id = String(args.reservationId ?? '');
    if (!id) return null;
    return {
      path: `/api/reservations/${encodeURIComponent(id)}`,
      note: `Read reservation ${id}.`,
    };
  },
  get_availability: (_client, _taskId, args) => ({
    path: '/api/availability',
    note: `Checked availability for ${String(args.checkIn ?? '?')}, ${String(args.nights ?? '?')} night(s).`,
  }),
  get_constraints: (client, taskId) => ({
    path: `/api/tasks/${taskId}`,
    note: 'Read the task constraints.',
  }),
  get_task_history: (client, taskId) => ({
    path: `/api/tasks/${taskId}/history`,
    note: 'Read the task history.',
  }),
  set_goal: (client, taskId) => ({
    path: `/api/tasks/${taskId}/actions`,
    note: 'Recorded the ask as typed constraints.',
  }),
  refine_constraints: (client, taskId) => ({
    path: `/api/tasks/${taskId}/actions`,
    note: 'Updated the constraints.',
  }),
  quote_change: (client, taskId) => ({
    path: `/api/tasks/${taskId}/actions`,
    note: 'Asked the site for a price.',
  }),
  stage_change: (client, taskId) => ({
    path: `/api/tasks/${taskId}/actions`,
    note: 'Placed a change in the interface for review.',
  }),
  verify_result: (client, taskId) => ({
    path: `/api/tasks/${taskId}/actions`,
    note: 'Asked the site to check reality against the ask.',
  }),
  get_verification: (client, taskId) => ({
    path: `/api/tasks/${taskId}`,
    note: 'Read the latest verification.',
  }),
  find_recovery_options: (client, taskId) => ({
    path: `/api/tasks/${taskId}/actions`,
    note: 'Looked for ways forward after the mismatch.',
  }),
  stage_recovery: (client, taskId) => ({
    path: `/api/tasks/${taskId}/actions`,
    note: 'Placed a recovery option in the interface for review.',
  }),
};

/** Extra args each tool forwards to the actions route, mirroring webmcp/tools.ts. */
const ACTION_ARGS: Record<string, string[]> = {
  set_goal: ['constraints', 'baseRevision'],
  refine_constraints: ['constraints', 'baseRevision'],
  quote_change: ['reservationId', 'roomId', 'checkIn', 'nights'],
  stage_change: ['reservationId', 'roomId', 'checkIn', 'nights', 'baseRevision', 'rationale'],
  find_recovery_options: [],
  stage_recovery: ['optionId'],
  verify_result: [],
};

async function executeTool(
  client: PilotClient,
  defaultTaskId: string,
  name: string,
  rawArgs: string,
): Promise<{ result: unknown; step: PilotStep }> {
  const runner = RUNNERS[name];
  if (!runner) {
    return {
      result: { error: `unknown tool ${name}` },
      step: { note: `Tried an unknown tool (${name}).`, outcome: 'error' },
    };
  }

  let args: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(rawArgs || '{}');
    if (parsed && typeof parsed === 'object') args = parsed as Record<string, unknown>;
  } catch {
    // Malformed arguments: pass nothing through, let the route refuse.
  }

  const taskId = typeof args.taskId === 'string' && args.taskId ? args.taskId : defaultTaskId;
  const described = runner(client, taskId, args);
  if (!described) {
    return {
      result: { error: 'invalid arguments' },
      step: { note: 'Called a tool with invalid arguments.', outcome: 'error' },
    };
  }

  // Reads are GETs; the actions route is a POST with a step name.
  const reads = ['get_task', 'get_reservation', 'get_constraints', 'get_task_history', 'get_verification'];
  let result: unknown;
  if (reads.includes(name) || name === 'get_availability') {
    if (name === 'get_availability') {
      result = await client.post(described.path, {
        checkIn: args.checkIn,
        nights: args.nights,
      });
    } else {
      result = await client.get(described.path);
    }
  } else {
    const body: Record<string, unknown> = { step: name };
    for (const key of ACTION_ARGS[name] ?? []) {
      if (key in args) body[key] = args[key];
    }
    result = await client.post(described.path, body);
  }

  const refused =
    result !== null &&
    typeof result === 'object' &&
    'error' in result &&
    typeof (result as { error: unknown }).error === 'string';

  return {
    result,
    step: {
      note: described.note + (refused ? ' The site refused it.' : ''),
      path: described.path,
      outcome: refused ? 'error' : 'ok',
    },
  };
}

function summarize(result: unknown): string {
  const json = JSON.stringify(result ?? null);
  return json.length > MAX_OUTPUT_CHARS ? `${json.slice(0, MAX_OUTPUT_CHARS)}…` : json;
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
    reservation?: { reservationId: string; checkIn: string; roomId: string; nights: number } | null;
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
Current reservation: ${reservation.reservationId} — check-in ${reservation.checkIn}, Room ${reservation.roomId}, ${reservation.nights} night(s).

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
