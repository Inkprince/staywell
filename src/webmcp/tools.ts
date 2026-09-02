'use client';

/**
 * The tool surface.
 *
 * Tools are *browser* code: they speak HTTP to the route handlers and import
 * nothing from `lib/proof` or `lib/store`. The boundary test holds this line —
 * and it is what makes "no agent can approve or commit" structural rather
 * than promised.
 *
 * Gating: the registered set is derived from task state, so `verify_result`
 * is genuinely *absent* until something has been committed — the agent cannot
 * even discover it early. `useWebMCPTools` re-syncs when the set changes,
 * firing the platform's toolchange event as a side effect.
 */

import type { ToolDescriptor } from './types';
import {
  FIND_RECOVERY_OPTIONS,
  GET_AVAILABILITY,
  GET_CONSTRAINTS,
  GET_RESERVATION,
  GET_TASK,
  GET_TASK_HISTORY,
  GET_VERIFICATION,
  QUOTE_CHANGE,
  REFINE_CONSTRAINTS,
  SET_GOAL,
  STAGE_CHANGE,
  STAGE_RECOVERY,
  VERIFY_RESULT,
} from './schemas';

/** What the tools layer needs to know about the page's task. */
export interface TaskContext {
  taskId: string | null;
  state: string;
}

// ---------------------------------------------------------------------------
// HTTP plumbing — the only way a tool reaches the server.

async function api(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON error pages land here; the status line is the message.
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

function post(path: string, body: unknown): Promise<unknown> {
  return api(path, { method: 'POST', body: JSON.stringify(body) });
}

function taskAction(
  taskId: string,
  step: string,
  extra: Record<string, unknown> = {},
): Promise<unknown> {
  return post(`/api/tasks/${taskId}/actions`, { step, ...extra });
}

// ---------------------------------------------------------------------------
// Tool builders. Each is a pure function of the TaskContext, so a changed
// state re-derives the gated set with no bookkeeping.

type Builder = (context: TaskContext) => ToolDescriptor | null;

/**
 * The task id an agent actually named. Tools take `taskId` as input so they
 * work from any page, but the context's task is the sensible default.
 */
function resolveTaskId(args: Record<string, unknown>, context: TaskContext): string {
  const named = typeof args.taskId === 'string' ? args.taskId : '';
  return named || context.taskId || '';
}

// Reads — registered whenever the page carries a task.

const getTask: Builder = (context) =>
  context.taskId
    ? {
        ...GET_TASK,
        execute: (args) => api(`/api/tasks/${resolveTaskId(args, context)}`),
      }
    : null;

const getReservation: Builder = (context) =>
  context.taskId
    ? {
        ...GET_RESERVATION,
        execute: (args) => {
          const reservationId = typeof args.reservationId === 'string' ? args.reservationId : '';
          if (!reservationId) return { error: 'reservationId is required, like "res_18"' };
          return api(`/api/reservations/${encodeURIComponent(reservationId)}`);
        },
      }
    : null;

const getAvailability: Builder = (context) =>
  context.taskId
    ? {
        ...GET_AVAILABILITY,
        execute: (args) => {
          const checkIn = typeof args.checkIn === 'string' ? args.checkIn : '';
          const nights = Number(args.nights);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(checkIn) || !Number.isInteger(nights) || nights < 1 || nights > 7) {
            return { error: 'checkIn (YYYY-MM-DD) and nights (1–7) are required' };
          }
          return post('/api/availability', { checkIn, nights });
        },
      }
    : null;

const getConstraints: Builder = (context) =>
  context.taskId
    ? {
        ...GET_CONSTRAINTS,
        execute: (args) => api(`/api/tasks/${resolveTaskId(args, context)}`),
      }
    : null;

const getTaskHistory: Builder = (context) =>
  context.taskId
    ? {
        ...GET_TASK_HISTORY,
        execute: (args) => api(`/api/tasks/${resolveTaskId(args, context)}/history`),
      }
    : null;

// Plan — the states in which the ask is still being shaped.

const PLANNING_STATES = new Set(['UNDERSTANDING', 'PLANNING', 'REPLANNING', 'READY_FOR_REVIEW']);

const setGoal: Builder = (context) =>
  context.taskId && PLANNING_STATES.has(context.state)
    ? {
        ...SET_GOAL,
        execute: (args) =>
          taskAction(resolveTaskId(args, context), 'set_goal', {
            constraints: args.constraints,
            baseRevision: args.baseRevision,
          }),
      }
    : null;

const refineConstraints: Builder = (context) =>
  context.taskId && PLANNING_STATES.has(context.state)
    ? {
        ...REFINE_CONSTRAINTS,
        execute: (args) =>
          taskAction(resolveTaskId(args, context), 'set_goal', {
            constraints: args.constraints,
            baseRevision: args.baseRevision,
          }),
      }
    : null;

const quoteChange: Builder = (context) =>
  context.taskId
    ? {
        ...QUOTE_CHANGE,
        execute: (args) =>
          taskAction(resolveTaskId(args, context), 'quote_change', {
            reservationId: args.reservationId,
            roomId: args.roomId,
            checkIn: args.checkIn,
            nights: args.nights,
          }),
      }
    : null;

const stageChange: Builder = (context) =>
  context.taskId && PLANNING_STATES.has(context.state)
    ? {
        ...STAGE_CHANGE,
        execute: (args) =>
          taskAction(resolveTaskId(args, context), 'stage_change', {
            reservationId: args.reservationId,
            roomId: args.roomId,
            checkIn: args.checkIn,
            nights: args.nights,
            baseRevision: args.baseRevision,
            rationale: args.rationale,
          }),
      }
    : null;

// Verify — only once a change has been applied and reality can be checked.

const VERIFYING_STATES = new Set([
  'VERIFYING',
  'MISMATCH',
  'VERIFIED',
  'ACCEPTED_WITH_EXCEPTIONS',
]);

const verifyResult: Builder = (context) =>
  context.taskId && VERIFYING_STATES.has(context.state)
    ? {
        ...VERIFY_RESULT,
        execute: (args) => taskAction(resolveTaskId(args, context), 'verify_result'),
      }
    : null;

const getVerification: Builder = (context) =>
  context.taskId && context.state !== 'NEW' && context.state !== 'UNDERSTANDING'
    ? {
        ...GET_VERIFICATION,
        execute: (args) => api(`/api/tasks/${resolveTaskId(args, context)}`),
      }
    : null;

// Recover — after a caught mismatch.

const RECOVERY_STATES = new Set(['MISMATCH', 'RECOVERING']);

const findRecoveryOptions: Builder = (context) =>
  context.taskId && RECOVERY_STATES.has(context.state)
    ? {
        ...FIND_RECOVERY_OPTIONS,
        execute: (args) =>
          taskAction(resolveTaskId(args, context), 'find_recovery_options'),
      }
    : null;

const stageRecovery: Builder = (context) =>
  context.taskId && RECOVERY_STATES.has(context.state)
    ? {
        ...STAGE_RECOVERY,
        execute: (args) =>
          taskAction(resolveTaskId(args, context), 'stage_recovery', {
            optionId: args.optionId,
          }),
      }
    : null;

// ---------------------------------------------------------------------------

const BUILDERS: readonly Builder[] = [
  getTask,
  getReservation,
  getAvailability,
  getConstraints,
  getTaskHistory,
  setGoal,
  refineConstraints,
  quoteChange,
  stageChange,
  verifyResult,
  getVerification,
  findRecoveryOptions,
  stageRecovery,
];

/**
 * Derives the full tool set for a task context. Lifecycle-gated: tools appear
 * and disappear as the task advances, and the platform's toolchange event
 * fires for each change as `useWebMCPTools` re-syncs.
 */
export function toolsForTask(context: TaskContext): ToolDescriptor[] {
  return BUILDERS.map((build) => build(context)).filter(
    (tool): tool is ToolDescriptor => tool !== null,
  );
}

/** The names a given state exposes — used by tests and the inspector. */
export function toolNamesForTask(context: TaskContext): string[] {
  return toolsForTask(context).map((t) => t.name);
}
