/**
 * The tool surface: lifecycle gating and HTTP behaviour.
 *
 * These tests pin the two properties the product promises:
 *
 * - the gated tools are genuinely *absent* in states where they must not be
 *   callable (an agent cannot even discover `verify_result` early), and
 * - every tool speaks HTTP to the route handlers, so the boundary between
 *   the agent surface and the transaction layer stays real.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toolNamesForTask, toolsForTask } from '@/webmcp/tools';
import { TOOL_DEFINITIONS, toolByName } from '@/webmcp/schemas';

const READ_TOOLS = ['get_task', 'get_reservation', 'get_availability', 'get_constraints', 'get_task_history'];
const PLAN_TOOLS = ['set_goal', 'refine_constraints', 'stage_change'];
const VERIFY_TOOLS = ['verify_result'];
const RECOVERY_TOOLS = ['find_recovery_options', 'stage_recovery'];

describe('lifecycle gating', () => {
  it('exposes reads whenever the page carries a task', () => {
    const names = toolNamesForTask({ taskId: 'task_1', state: 'UNDERSTANDING' });
    for (const tool of READ_TOOLS) expect(names).toContain(tool);
  });

  it('exposes nothing without a task on the page', () => {
    expect(toolNamesForTask({ taskId: null, state: 'NEW' })).toEqual([]);
  });

  it('exposes planning tools while the ask is being shaped', () => {
    for (const state of ['UNDERSTANDING', 'PLANNING', 'REPLANNING', 'READY_FOR_REVIEW']) {
      const names = toolNamesForTask({ taskId: 'task_1', state });
      for (const tool of PLAN_TOOLS) expect(names).toContain(tool);
    }
  });

  it('hides planning tools once a change is in flight', () => {
    for (const state of ['APPROVED', 'EXECUTING', 'VERIFYING', 'MISMATCH']) {
      const names = toolNamesForTask({ taskId: 'task_1', state });
      for (const tool of PLAN_TOOLS) expect(names).not.toContain(tool);
    }
  });

  it('keeps verify_result absent until something has been committed', () => {
    // The core §26 property, mirrored on the tool surface.
    for (const state of ['NEW', 'UNDERSTANDING', 'PLANNING', 'READY_FOR_REVIEW', 'APPROVED', 'EXECUTING']) {
      const names = toolNamesForTask({ taskId: 'task_1', state });
      expect(names).not.toContain('verify_result');
    }
  });

  it('reveals verify_result in the checking states', () => {
    for (const state of ['VERIFYING', 'MISMATCH', 'VERIFIED', 'ACCEPTED_WITH_EXCEPTIONS']) {
      const names = toolNamesForTask({ taskId: 'task_1', state });
      expect(names).toContain('verify_result');
    }
  });

  it('reveals recovery tools only after a caught mismatch', () => {
    for (const state of ['PLANNING', 'READY_FOR_REVIEW', 'VERIFYING', 'VERIFIED']) {
      const names = toolNamesForTask({ taskId: 'task_1', state });
      for (const tool of RECOVERY_TOOLS) expect(names).not.toContain(tool);
    }
    for (const state of ['MISMATCH', 'RECOVERING']) {
      const names = toolNamesForTask({ taskId: 'task_1', state });
      for (const tool of RECOVERY_TOOLS) expect(names).toContain(tool);
    }
  });

  it('never exposes approval or commit, in any state', () => {
    const ALL_STATES = [
      'NEW',
      'UNDERSTANDING',
      'PLANNING',
      'READY_FOR_REVIEW',
      'APPROVED',
      'EXECUTING',
      'VERIFYING',
      'VERIFIED',
      'MISMATCH',
      'RECOVERING',
      'REPLANNING',
      'ACCEPTED_WITH_EXCEPTIONS',
      'ABANDONED',
    ];
    for (const state of ALL_STATES) {
      const names = toolNamesForTask({ taskId: 'task_1', state });
      expect(names).not.toContain('approve_change');
      expect(names).not.toContain('commit_change');
      expect(names).not.toContain('set_verified');
    }
  });
});

describe('schemas', () => {
  it('defines every tool the builders can register', () => {
    // Every gated name exists in the schema roll-up (single source of truth).
    const defined = new Set(TOOL_DEFINITIONS.map((t) => t.name));
    for (const name of [...READ_TOOLS, ...PLAN_TOOLS, 'quote_change', ...VERIFY_TOOLS, 'get_verification', ...RECOVERY_TOOLS]) {
      expect(defined.has(name)).toBe(true);
    }
  });

  it('gives every tool an agent-facing description and object schema', () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.description.length).toBeGreaterThan(40);
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
  });

  it('documents the revision contract on mutating tools', () => {
    for (const name of ['set_goal', 'refine_constraints', 'stage_change']) {
      const tool = toolByName(name)!;
      const schema = JSON.stringify(tool.inputSchema);
      expect(schema).toContain('baseRevision');
    }
  });
});

describe('tool execution goes through HTTP', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('get_task fetches the task route', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ task: { id: 'task_1' } }), { status: 200 }),
    );

    const [tool] = toolsForTask({ taskId: 'task_1', state: 'PLANNING' }).filter(
      (t) => t.name === 'get_task',
    );
    await tool!.execute({ taskId: 'task_2' });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [path, init] = fetchMock.mock.calls[0]!;
    expect(String(path)).toContain('/api/tasks/task_2');
    expect(init?.method).toBeUndefined();
  });

  it('stage_change posts to the actions route with the step', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ task: {} }), { status: 200 }),
    );

    const [tool] = toolsForTask({ taskId: 'task_1', state: 'PLANNING' }).filter(
      (t) => t.name === 'stage_change',
    );
    await tool!.execute({
      reservationId: 'res_18',
      roomId: '418',
      checkIn: '2026-09-04',
      nights: 2,
      baseRevision: 3,
      rationale: 'Move to Friday, same room.',
    });

    const [path, init] = fetchMock.mock.calls[0]!;
    expect(String(path)).toContain('/api/tasks/task_1/actions');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ step: 'stage_change', roomId: '418', baseRevision: 3 });
  });

  it('verify_result takes no state as input — the server re-reads reality itself', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ verification: { matched: true } }), { status: 200 }),
    );

    const [tool] = toolsForTask({ taskId: 'task_1', state: 'VERIFYING' }).filter(
      (t) => t.name === 'verify_result',
    );
    await tool!.execute({ taskId: 'task_1' });

    const [path, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String(init?.body));
    // Only the step; not even the task id rides in the body — it is in the
    // URL — and certainly no expected state. The checker owns all of that.
    expect(Object.keys(body)).toEqual(['step']);
    expect(String(path)).toContain('/api/tasks/task_1/actions');
  });

  it('returns the server’s error message, not a rejection', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'that stay is outside the bookable window' }), {
        status: 400,
      }),
    );

    const [tool] = toolsForTask({ taskId: 'task_1', state: 'PLANNING' }).filter(
      (t) => t.name === 'set_goal',
    );
    const result = (await tool!.execute({
      taskId: 'task_1',
      baseRevision: 2,
      constraints: [{ kind: 'date_equals', date: '2026-09-04' }],
    })) as { error: string; httpStatus: number };

    expect(result.error).toBe('that stay is outside the bookable window');
    expect(result.httpStatus).toBe(400);
  });

  it('get_availability validates its own input before calling', async () => {
    const [tool] = toolsForTask({ taskId: 'task_1', state: 'PLANNING' }).filter(
      (t) => t.name === 'get_availability',
    );

    const result = (await tool!.execute({ checkIn: 'not-a-date', nights: 2 })) as {
      error: string;
    };
    expect(result.error).toContain('checkIn');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
