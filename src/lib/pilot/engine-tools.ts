/**
 * The shared machinery of the model-backed pilot engines (OpenAI Responses,
 * Groq chat completions): the fixed system prompt, the fixed parse
 * instructions, and tool execution over plain HTTP.
 *
 * Everything an engine can do is defined here exactly once, so both engines
 * hand the model the *same tool definitions the browser registers* — sourced
 * from webmcp/schemas.ts — and execute every call against the app's own
 * routes with the caller's cookies. No engine gets a power the browser's
 * tools lack: approving, committing, and declaring success simply have no
 * tool, and the routes enforce the rest.
 */

import { TOOL_DEFINITIONS } from '@/webmcp/schemas';
import type { PilotClient, PilotStep } from './scripted';

export const MAX_TURNS = 12;
export const MAX_OUTPUT_CHARS = 4000;

// ---------------------------------------------------------------------------
// Fixed prompts. The route never accepts prompt text from the request.

export const SYSTEM_PROMPT = `You are Proof's pilot agent, working inside a hotel-booking demo called StayWell.

Your job: take the human's goal for their reservation and drive the task as far as you legitimately can — understand the ask as typed constraints, quote the change, and stage it for review. Then stop.

Hard rules:
- You cannot approve a change, commit a change, or declare success. Those belong to the human and the site. Do not try; refusals are final.
- Nothing is applied until the human approves it in the page. Staging is your finish line.
- Read the task and constraints before planning. Quote before staging.
- Only stage a change you believe satisfies every constraint. If nothing can, say so plainly and stop — do not stage a compromise silently.
- After a caught mismatch, you may find recovery options and stage one ONLY if it violates no stated constraint. Trade-offs are the human's to make.

You have at most a dozen turns. Be economical: read what you need, act, stop.`;

export const PARSE_INSTRUCTIONS = `You translate a hotel-guest request into typed constraints. Respond with only JSON of the form:
{"constraints":[{"kind":"date_equals","date":"YYYY-MM-DD"}|{"kind":"room_equals","roomId":"NNN"}|{"kind":"price_at_most","amount":N}|{"kind":"unchanged","field":"checkIn"|"roomId"|"nights"|"totalPrice"|"guestName"|"ratePlanId"|"status"|"reservationId"}]}

Rules:
- Weekday names map to dates in the week starting Tuesday 2026-09-01 (so "Friday" is 2026-09-04).
- "Same room" / "keep my room" is room_equals with the current room.
- Price limits ("under $300", "no more than $300") are price_at_most.
- "One night shorter" and similar length changes are {kind:"unchanged",field:"nights"} only when the request is explicit about keeping something; otherwise omit them.
- Never invent constraints the human did not state. An empty array is a valid answer.`;

// ---------------------------------------------------------------------------
// Tool descriptions, derived from the same source of truth the browser uses.

/**
 * TOOL_DEFINITIONS in the flat shape the OpenAI Responses API expects.
 * Chat-completions engines (Groq) nest the same fields under `function`.
 */
export function functionTools(): unknown[] {
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
    note: 'Wrote down what you asked for, in words the site can check.',
  }),
  refine_constraints: (client, taskId) => ({
    path: `/api/tasks/${taskId}/actions`,
    note: 'Updated what you asked for.',
  }),
  quote_change: (client, taskId) => ({
    path: `/api/tasks/${taskId}/actions`,
    note: 'Asked the site for a price.',
  }),
  stage_change: (client, taskId) => ({
    path: `/api/tasks/${taskId}/actions`,
    note: 'Prepared a change for you to look over.',
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
    note: 'Prepared a way forward for you to look over.',
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

export async function executeTool(
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

export function summarize(result: unknown): string {
  const json = JSON.stringify(result ?? null);
  return json.length > MAX_OUTPUT_CHARS ? `${json.slice(0, MAX_OUTPUT_CHARS)}…` : json;
}
