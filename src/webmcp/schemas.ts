/**
 * Tool schemas — the single source of truth.
 *
 * The same definitions feed `registerTool` (the browser surface) and, later,
 * the server-side pilot's function definitions. If a schema changes, it
 * changes here and nowhere else — agent-visible behaviour and the pilot stay
 * in lockstep by construction.
 *
 * Naming and scope: small, atomic, composable tools with
 * lifecycle-aware registration. Descriptions are written *to the agent*: they
 * say what the tool knows, what it cannot do, and what to do next.
 */

import type { JSONSchema } from './types';

export interface ToolDefinition<S extends JSONSchema = JSONSchema> {
  name: string;
  description: string;
  inputSchema: S;
}

const TASK_ID_SCHEMA: JSONSchema = {
  type: 'string',
  pattern: '^task_[0-9]+$',
  description: 'The task to work on. Get one from get_task_history or the page you are on.',
};

const RESERVATION_ID_SCHEMA: JSONSchema = {
  type: 'string',
  pattern: '^res_\\w+$',
  description: 'The reservation being changed, like "res_18".',
};

const ROOM_ID_SCHEMA: JSONSchema = {
  type: 'string',
  pattern: '^[0-9]{3}$',
  description: 'A room number like "418".',
};

const DATE_SCHEMA: JSONSchema = {
  type: 'string',
  pattern: '^\\d{4}-\\d{2}-\\d{2}$',
  description: 'A date like "2026-09-04" (Friday).',
};

// ---------------------------------------------------------------------------
// Read

export const GET_TASK: ToolDefinition = {
  name: 'get_task',
  description:
    'Read one task: its goal in the human’s words, its current state, the typed constraints it must satisfy, any change staged for review, and the latest verification. Start here before planning anything.',
  inputSchema: {
    type: 'object',
    properties: { taskId: TASK_ID_SCHEMA },
    required: ['taskId'],
    additionalProperties: false,
  },
};

export const GET_RESERVATION: ToolDefinition = {
  name: 'get_reservation',
  description:
    'Read the current, authoritative state of a reservation: room, dates, nights, total price, status. This is what the site actually holds — not what was last said to the human.',
  inputSchema: {
    type: 'object',
    properties: { reservationId: RESERVATION_ID_SCHEMA },
    required: ['reservationId'],
    additionalProperties: false,
  },
};

export const GET_AVAILABILITY: ToolDefinition = {
  name: 'get_availability',
  description:
    'List rooms with a fresh quote for a stay (check-in date and nights), including the pricing tier that produced each total. Read-only; quoting never changes anything.',
  inputSchema: {
    type: 'object',
    properties: {
      checkIn: DATE_SCHEMA,
      nights: { type: 'integer', minimum: 1, maximum: 7 },
    },
    required: ['checkIn', 'nights'],
    additionalProperties: false,
  },
};

export const GET_CONSTRAINTS: ToolDefinition = {
  name: 'get_constraints',
  description:
    'Read the typed constraints the human set for a task. These are predicates the site checks itself — a plan that violates one will be caught, so read them before staging anything.',
  inputSchema: {
    type: 'object',
    properties: { taskId: TASK_ID_SCHEMA },
    required: ['taskId'],
    additionalProperties: false,
  },
};

export const GET_TASK_HISTORY: ToolDefinition = {
  name: 'get_task_history',
  description:
    'Read the audit trail for a task: every quote, stage, approval, commit, and verification in order. Use this to understand where a task has been before continuing it.',
  inputSchema: {
    type: 'object',
    properties: { taskId: TASK_ID_SCHEMA },
    required: ['taskId'],
    additionalProperties: false,
  },
};

// ---------------------------------------------------------------------------
// Plan

export const SET_GOAL: ToolDefinition = {
  name: 'set_goal',
  description:
    'Record the human’s ask as typed constraints. Free text is not accepted — translate the ask into predicates (date_equals, room_equals, price_at_most, unchanged) and pass them with the revision from get_task. Constraints the site cannot check will be refused.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: TASK_ID_SCHEMA,
      baseRevision: {
        type: 'integer',
        minimum: 0,
        description: 'The task revision you read this from. Refused if state has moved on.',
      },
      constraints: {
        type: 'array',
        minItems: 1,
        description: 'Typed constraints. Every one will be checked after any change.',
        items: {
          type: 'object',
          oneOf: [
            {
              properties: { kind: { const: 'date_equals' }, date: DATE_SCHEMA },
              required: ['kind', 'date'],
              additionalProperties: false,
            },
            {
              properties: { kind: { const: 'room_equals' }, roomId: ROOM_ID_SCHEMA },
              required: ['kind', 'roomId'],
              additionalProperties: false,
            },
            {
              properties: {
                kind: { const: 'price_at_most' },
                amount: { type: 'number', exclusiveMinimum: 0 },
              },
              required: ['kind', 'amount'],
              additionalProperties: false,
            },
            {
              properties: {
                kind: { const: 'unchanged' },
                field: {
                  type: 'string',
                  enum: [
                    'reservationId',
                    'checkIn',
                    'roomId',
                    'totalPrice',
                    'guestName',
                    'ratePlanId',
                    'nights',
                    'status',
                  ],
                },
              },
              required: ['kind', 'field'],
              additionalProperties: false,
            },
          ],
        },
      },
    },
    required: ['taskId', 'baseRevision', 'constraints'],
    additionalProperties: false,
  },
};

export const REFINE_CONSTRAINTS: ToolDefinition = {
  name: 'refine_constraints',
  description:
    'Change the constraints on a task — when the human clarified their ask, or you discovered a constraint you set was wrong. Pass the complete new list; this replaces, not merges. Any change staged against the old constraints becomes out of date.',
  inputSchema: SET_GOAL.inputSchema,
};

export const QUOTE_CHANGE: ToolDefinition = {
  name: 'quote_change',
  description:
    'Get the site’s price for a proposed change, before proposing it. Read-only. The quote carries the occupancy and pricing tier that produced it — the same formula will be applied at commit, but the price may legitimately have changed by then.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: TASK_ID_SCHEMA,
      reservationId: RESERVATION_ID_SCHEMA,
      roomId: ROOM_ID_SCHEMA,
      checkIn: DATE_SCHEMA,
      nights: { type: 'integer', minimum: 1, maximum: 7 },
    },
    required: ['taskId', 'reservationId', 'roomId', 'checkIn', 'nights'],
    additionalProperties: false,
  },
};

export const STAGE_CHANGE: ToolDefinition = {
  name: 'stage_change',
  description:
    'Place a proposed change in the interface for the human to review. This does not apply the change — nothing is applied until the person approves it in the page. Staging records the revision it was planned against; if the world moves on, staging again is required.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: TASK_ID_SCHEMA,
      reservationId: RESERVATION_ID_SCHEMA,
      roomId: ROOM_ID_SCHEMA,
      checkIn: DATE_SCHEMA,
      nights: { type: 'integer', minimum: 1, maximum: 7 },
      baseRevision: {
        type: 'integer',
        minimum: 0,
        description: 'The task revision you planned against. Stale plans are refused.',
      },
      rationale: {
        type: 'string',
        maxLength: 300,
        description: 'One line for the human: why this change satisfies their ask.',
      },
    },
    required: ['taskId', 'reservationId', 'roomId', 'checkIn', 'nights', 'baseRevision'],
    additionalProperties: false,
  },
};

// ---------------------------------------------------------------------------
// Verify (lifecycle-gated: registered only once something has been committed)

export const VERIFY_RESULT: ToolDefinition = {
  name: 'verify_result',
  description:
    'Ask the site to check reality against the task. Takes no state as input — the site re-reads its own current state and compares it with the constraints, then reports which held and what, if anything, changed unexpectedly. Only available after a change has been applied.',
  inputSchema: {
    type: 'object',
    properties: { taskId: TASK_ID_SCHEMA },
    required: ['taskId'],
    additionalProperties: false,
  },
};

export const GET_VERIFICATION: ToolDefinition = {
  name: 'get_verification',
  description:
    'Read the latest verification for a task: the per-constraint verdicts and any unrequested changes, with the moment it was checked. Read-only; use verify_result to run a fresh check.',
  inputSchema: {
    type: 'object',
    properties: { taskId: TASK_ID_SCHEMA },
    required: ['taskId'],
    additionalProperties: false,
  },
};

// ---------------------------------------------------------------------------
// Recover

export const FIND_RECOVERY_OPTIONS: ToolDefinition = {
  name: 'find_recovery_options',
  description:
    'After a caught mismatch, list what can be done: other rooms (quoted fresh), keeping the result as it stands, or returning to the previous reservation. Every option says which constraints it satisfies and which it breaks. None of them is applied by calling this — the human chooses.',
  inputSchema: {
    type: 'object',
    properties: { taskId: TASK_ID_SCHEMA },
    required: ['taskId'],
    additionalProperties: false,
  },
};

export const STAGE_RECOVERY: ToolDefinition = {
  name: 'stage_recovery',
  description:
    'Stage one of the recovery options for the human to review — the same review-and-approve path as any other change. An option that violates a stated constraint will be accepted only for staging: the human sees the trade-off and decides.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: TASK_ID_SCHEMA,
      optionId: {
        type: 'string',
        description: 'The recovery option id from find_recovery_options.',
      },
    },
    required: ['taskId', 'optionId'],
    additionalProperties: false,
  },
};

// ---------------------------------------------------------------------------
// The roll-up, for registration and for the pilot.

export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  GET_TASK,
  GET_RESERVATION,
  GET_AVAILABILITY,
  GET_CONSTRAINTS,
  GET_TASK_HISTORY,
  SET_GOAL,
  REFINE_CONSTRAINTS,
  QUOTE_CHANGE,
  STAGE_CHANGE,
  VERIFY_RESULT,
  GET_VERIFICATION,
  FIND_RECOVERY_OPTIONS,
  STAGE_RECOVERY,
] as const;

export function toolByName(name: string): ToolDefinition | undefined {
  return TOOL_DEFINITIONS.find((t) => t.name === name);
}
