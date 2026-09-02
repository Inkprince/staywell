/**
 * The scripted pilot — the deterministic engine under the demo.
 *
 * Two things are under test:
 *
 * 1. The parser: human words → typed constraints, honestly. A field becomes
 *    an `unchanged` constraint only when the ask leaves it untouched; an
 *    absolute ask ("two nights") is a change, never a constraint.
 *
 * 2. The loop. The fake client here is *not* a mock of the server's
 *    behaviour — it mirrors the route handlers by calling the real
 *    transaction loop, so the step names and payload shapes the pilot
 *    emits are the ones that genuinely work. Every call is recorded, and
 *    every run ends with the no-privileges assertion: the pilot never
 *    touches /approve, /decide, or any step outside the agent's surface.
 */

import { describe, expect, it } from 'vitest';
import { parseGoal, runScriptedPilot, type PilotClient, type PilotStep } from '@/lib/pilot/scripted';
import {
  commitStaged,
  approveChange,
  getQuote,
  issueApprovalNonce,
  setConstraints,
  stageChange,
  stageRecovery,
  startTask,
  snapshotOf,
  verifyResult,
} from '@/lib/proof/transaction';
import { findRecoveryOptions } from '@/lib/proof/recovery';
import { taskView } from '@/lib/http/task-view';
import { MemoryStore, type Workspace } from '@/lib/store/memory';
import { ROOMS, quoteStay, stayDates, type StayWellWorld } from '@/lib/staywell/world';

const FRIDAY = '2026-09-04';
const CURRENT = { checkIn: '2026-09-02', roomId: '418', nights: 2 };

/** Every step an agent may drive — the same list the actions route allows. */
const AGENT_STEPS = [
  'set_goal',
  'quote_change',
  'stage_change',
  'verify_result',
  'find_recovery_options',
  'stage_recovery',
];

/** The paths the pilot is allowed to call, period. */
const PILOT_PATHS = [
  /^\/api\/tasks\/task_\d+$/,
  /^\/api\/tasks\/task_\d+\/actions$/,
  /^\/api\/availability$/,
];

// ---------------------------------------------------------------------------
// The route-mirroring client

interface Recorded {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
}

function routeClient(initial: Workspace): {
  client: PilotClient;
  calls: Recorded[];
  workspace: () => Workspace;
} {
  let ws = initial;
  const calls: Recorded[] = [];

  async function action(taskId: string, body: Record<string, unknown>): Promise<unknown> {
    try {
      switch (body.step) {
        case 'set_goal': {
          ws = setConstraints(
            ws,
            taskId,
            body.constraints as never,
            body.baseRevision as number,
          );
          return { task: taskView(ws.tasks.find((t) => t.id === taskId)!) };
        }
        case 'quote_change': {
          const { quote, reservation } = getQuote(ws, taskId, body as never);
          return { quote, reservation };
        }
        case 'stage_change': {
          const staged = stageChange(ws, taskId, body as never, {
            rationale: body.rationale as string | undefined,
            baseRevision: body.baseRevision as number,
          });
          ws = staged.workspace;
          return { task: taskView(staged.task), change: staged.change };
        }
        case 'find_recovery_options': {
          return { options: findRecoveryOptions(ws, taskId) };
        }
        case 'stage_recovery': {
          const option = findRecoveryOptions(ws, taskId).find(
            (o) => o.id === body.optionId,
          );
          if (!option || !option.request) return { error: `no recovery option` };
          const staged = stageRecovery(ws, taskId, {
            request: option.request,
            summary: option.summary,
          });
          ws = staged.workspace;
          return { task: taskView(staged.task) };
        }
        case 'commit_change':
        case 'approve_change':
          return {
            error: 'committing and approving are not available to agents',
            httpStatus: 403,
          };
        default:
          return { error: `unknown step "${String(body.step)}"`, httpStatus: 400 };
      }
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : 'refused' };
    }
  }

  function availability(world: StayWellWorld, body: Record<string, unknown>): unknown {
    const checkIn = String(body.checkIn ?? '');
    const nights = Number(body.nights);
    const dates = stayDates(checkIn, nights);
    const rooms = ROOMS.map((room) => {
      const available = !world.reservations.some(
        (r) =>
          r.status !== 'cancelled' &&
          r.roomId === room.id &&
          stayDates(r.checkIn, r.nights).some((d) => dates.includes(d)),
      );
      const quote = quoteStay(world, { roomId: room.id, checkIn, nights });
      return { roomId: room.id, available, quote: { totalDollars: quote.totalDollars } };
    });
    return { checkIn, nights, rooms };
  }

  const client: PilotClient = {
    async get(path) {
      calls.push({ method: 'GET', path });
      const match = path.match(/^\/api\/tasks\/(task_\d+)$/);
      if (!match) return { error: 'not found' };
      const task = ws.tasks.find((t) => t.id === match[1]);
      if (!task) return { error: `no task "${match[1]}"` };
      const reservation =
        ws.world.reservations.find((r) => r.id === task.staged?.request.reservationId) ??
        ws.world.reservations[0];
      return {
        task: taskView(task),
        reservation: reservation ? snapshotOf(reservation) : null,
      };
    },
    async post(path, body) {
      calls.push({ method: 'POST', path, body });
      const match = path.match(/^\/api\/tasks\/(task_\d+)\/actions$/);
      if (match) return action(match[1]!, body as Record<string, unknown>);
      if (path === '/api/availability') {
        try {
          return availability(ws.world, body as Record<string, unknown>);
        } catch (cause) {
          return { error: cause instanceof Error ? cause.message : 'refused' };
        }
      }
      return { error: 'not found' };
    },
  };

  return { client, calls, workspace: () => ws };
}

function workspaceFor(seed: number): Workspace {
  return new MemoryStore().createWorkspace('ws_pilot_test', seed);
}

async function runPilot(client: PilotClient, taskId: string): Promise<PilotStep[]> {
  const steps: PilotStep[] = [];
  for await (const step of runScriptedPilot(client, taskId)) steps.push(step);
  return steps;
}

/** The pilot may only ever speak to the agent's own surface. */
function assertNoPrivileges(calls: Recorded[]) {
  for (const call of calls) {
    expect(PILOT_PATHS.some((pattern) => pattern.test(call.path))).toBe(true);
    expect(call.path).not.toContain('/approve');
    expect(call.path).not.toContain('/decide');
    if (call.method === 'POST' && call.path.endsWith('/actions')) {
      const step = (call.body as { step?: string }).step;
      expect(AGENT_STEPS).toContain(step);
      // The scripted pilot never asks the site to verify its own work either:
      // verification is the site's job, triggered by the application.
      expect(step).not.toBe('verify_result');
    }
  }
}

// ---------------------------------------------------------------------------
// The parser

describe('parseGoal', () => {
  it('reads a weekday and a price ceiling', () => {
    const parsed = parseGoal(
      'Move my reservation to Friday without spending more than $300.',
      CURRENT,
    );
    expect(parsed.constraints).toEqual([
      { kind: 'date_equals', date: FRIDAY },
      { kind: 'price_at_most', amount: 300 },
    ]);
    expect(parsed.stay.checkIn).toBe(FRIDAY);
  });

  it('maps every weekday into the demo week', () => {
    expect(parseGoal('move to tuesday', CURRENT).stay.checkIn).toBe('2026-09-01');
    expect(parseGoal('move to Monday', CURRENT).stay.checkIn).toBe('2026-09-07');
    expect(parseGoal('move to saturday please', CURRENT).stay.checkIn).toBe('2026-09-05');
  });

  it('keeps the same room when the human says so', () => {
    const parsed = parseGoal('Keep my room, but make the stay one night shorter.', CURRENT);
    expect(parsed.constraints).toContainEqual({ kind: 'room_equals', roomId: '418' });
    expect(parsed.stay.roomId).toBe('418');
    expect(parsed.stay.nights).toBe(1); // two nights, one shorter
    // A change is not a constraint: nothing claims nights are unchanged.
    expect(parsed.constraints).not.toContainEqual({ kind: 'unchanged', field: 'nights' });
  });

  it('treats an absolute length as a change, never as unchanged', () => {
    const parsed = parseGoal('Stay three nights instead.', CURRENT);
    expect(parsed.stay.nights).toBe(3);
    expect(parsed.constraints).not.toContainEqual({ kind: 'unchanged', field: 'nights' });
  });

  it('understands a night longer', () => {
    const parsed = parseGoal('make the stay one night longer', CURRENT);
    expect(parsed.stay.nights).toBe(3);
  });

  it('reads the quieter-room ask as a different room with the same nights', () => {
    const parsed = parseGoal('Move me to a quieter room for the same nights.', CURRENT);
    expect(parsed.wantsDifferentRoom).toBe(true);
    expect(parsed.stay.roomId).toBeUndefined();
    expect(parsed.stay.nights).toBe(2);
    expect(parsed.constraints).toContainEqual({ kind: 'unchanged', field: 'nights' });
    expect(parsed.constraints).toContainEqual({ kind: 'unchanged', field: 'checkIn' });
  });

  it('names a room explicitly', () => {
    const parsed = parseGoal('Room 405, under $250.', CURRENT);
    expect(parsed.constraints).toContainEqual({ kind: 'room_equals', roomId: '405' });
    expect(parsed.constraints).toContainEqual({ kind: 'price_at_most', amount: 250 });
    expect(parsed.stay.roomId).toBe('405');
  });

  it('takes an explicit date over a weekday word', () => {
    const parsed = parseGoal('check in 2026-09-05, not Saturday', CURRENT);
    expect(parsed.constraints).toContainEqual({ kind: 'date_equals', date: '2026-09-05' });
    expect(parsed.stay.checkIn).toBe('2026-09-05');
  });
});

// ---------------------------------------------------------------------------
// The loop

describe('the scripted pilot loop', () => {
  it('drives a fresh task to review and stops for the human', async () => {
    const started = startTask(
      workspaceFor(1),
      'Move my reservation to Friday without spending more than $300.',
    );
    const { client, calls, workspace } = routeClient(started.workspace);

    const steps = await runPilot(client, started.task.id);

    const task = workspace().tasks.find((t) => t.id === started.task.id)!;
    expect(task.state).toBe('READY_FOR_REVIEW');
    expect(task.staged?.request.checkIn).toBe(FRIDAY);
    expect(task.staged?.request.roomId).toBe('418'); // room was never in the ask
    expect(steps.at(-1)?.outcome).toBe('needs-you');
    assertNoPrivileges(calls);
  });

  it('picks a different room for the quieter-room ask, cheapest available', async () => {
    const started = startTask(workspaceFor(2), 'Move me to a quieter room for the same nights.');
    const { client, calls, workspace } = routeClient(started.workspace);

    const steps = await runPilot(client, started.task.id);

    const task = workspace().tasks.find((t) => t.id === started.task.id)!;
    expect(task.state).toBe('READY_FOR_REVIEW');
    expect(task.staged?.request.roomId).not.toBe('418');
    expect(task.staged?.request.checkIn).toBe('2026-09-02'); // dates untouched
    expect(task.staged?.request.nights).toBe(2); // nights untouched
    expect(steps.some((s) => s.path === '/api/availability')).toBe(true);
    assertNoPrivileges(calls);
  });

  it('refuses to pick a trade after the caught mismatch — the human decides', async () => {
    // Seed 4: the pinned demo. Every option after the mismatch breaks one of
    // the three stated conditions, so the pilot must lay them out and stop.
    const { ws, taskId } = mismatchWorkspace();
    const { client, calls, workspace } = routeClient(ws);

    const steps = await runPilot(client, taskId);

    const task = workspace().tasks.find((t) => t.id === taskId)!;
    expect(task.state).toBe('MISMATCH'); // untouched: the choice is not the pilot's
    expect(steps.at(-1)?.outcome).toBe('needs-you');
    expect(
      calls.some(
        (c) => c.method === 'POST' && (c.body as { step?: string }).step === 'stage_recovery',
      ),
    ).toBe(false);
    assertNoPrivileges(calls);
  });

  it('stages a recovery option when one violates nothing', async () => {
    // Date + price only (no room in the ask): after the seed-4 mismatch,
    // another room on Friday under $300 satisfies everything — that, the
    // pilot may stage; it still waits for approval like any change.
    const { ws, taskId } = mismatchWorkspace([
      { kind: 'date_equals', date: FRIDAY },
      { kind: 'price_at_most', amount: 300 },
    ]);
    const { client, calls, workspace } = routeClient(ws);

    const steps = await runPilot(client, taskId);

    const task = workspace().tasks.find((t) => t.id === taskId)!;
    expect(task.state).toBe('READY_FOR_REVIEW');
    expect(task.staged?.request.roomId).not.toBe('418');
    expect(steps.at(-1)?.outcome).toBe('needs-you');
    assertNoPrivileges(calls);
  });

  it('says so when it cannot understand the ask', async () => {
    const started = startTask(workspaceFor(3), 'Make it nicer somehow.');
    const { client, calls } = routeClient(started.workspace);

    const steps = await runPilot(client, started.task.id);

    expect(steps.at(-1)?.outcome).toBe('needs-you');
    expect(steps.at(-1)?.note).toContain('could not turn that request');
    assertNoPrivileges(calls);
  });

  it('reports an unknown task without touching anything', async () => {
    const { client, calls } = routeClient(workspaceFor(5));
    const steps = await runPilot(client, 'task_99');
    expect(steps.at(-1)?.outcome).toBe('error');
    assertNoPrivileges(calls);
  });
});

// ---------------------------------------------------------------------------

/**
 * The pinned mismatch: constraints staged, approved, committed, verified —
 * and caught. Same shape as the human-decisions harness.
 */
function mismatchWorkspace(
  constraints = [
    { kind: 'date_equals', date: FRIDAY },
    { kind: 'room_equals', roomId: '418' },
    { kind: 'price_at_most', amount: 300 },
  ],
): { ws: Workspace; taskId: string } {
  let ws = workspaceFor(4);
  const goal = 'Move my reservation to Friday, keep the same room, stay under $300';
  const start = startTask(ws, goal);
  ws = start.workspace;
  const taskId = start.task.id;

  ws = setConstraints(ws, taskId, constraints as never, ws.world.revision);
  ws = stageChange(
    ws,
    taskId,
    { reservationId: 'res_18', roomId: '418', checkIn: FRIDAY, nights: 2 },
    { rationale: 'Move to Friday, same room.', baseRevision: ws.world.revision },
  ).workspace;

  const issued = issueApprovalNonce(ws, taskId);
  const approved = approveChange(issued.workspace, taskId, issued.nonce.id);
  const committed = commitStaged(approved.workspace, taskId);
  ws = verifyResult(committed.workspace, taskId).workspace;

  const task = ws.tasks.find((t) => t.id === taskId)!;
  expect(task.state).toBe('MISMATCH');
  return { ws, taskId };
}
