/**
 * The registry is a module singleton, so each test re-imports it fresh rather
 * than trying to unwind shared state. `resetModules` also clears the adapter's
 * memoised environment resolution, which is exactly the isolation needed.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolDescriptor } from '@/webmcp/types';
import { FakeModelContext } from './fake-model-context';

let registry: typeof import('@/webmcp/registry');
let ctx: FakeModelContext;

beforeEach(async () => {
  vi.resetModules();
  ctx = new FakeModelContext();
  Object.defineProperty(document, 'modelContext', { value: ctx, configurable: true });

  registry = await import('@/webmcp/registry');
});

function tool(name: string, execute?: ToolDescriptor['execute']): ToolDescriptor {
  return {
    name,
    description: `tool ${name}`,
    inputSchema: { type: 'object', properties: {} },
    execute:
      execute ??
      (() => ({
        from: name,
      })),
  };
}

describe('registration lifecycle', () => {
  it('registers the desired set with the platform', async () => {
    await registry.toolRegistry.sync([tool('get_task'), tool('get_room')]);

    expect(ctx.names()).toEqual(['get_task', 'get_room']);
    expect(registry.toolRegistry.getSnapshot().registered).toEqual([
      'get_task',
      'get_room',
    ]);
  });

  it('unregisters tools that leave the desired set, by aborting their signal', async () => {
    await registry.toolRegistry.sync([tool('get_task'), tool('verify_result')]);
    await registry.toolRegistry.sync([tool('get_task')]);

    expect(ctx.names()).toEqual(['get_task']);
    expect(ctx.wasAborted('verify_result')).toBe(true);
  });

  it('replaces a tool whose descriptor changed so the handler is current', async () => {
    let answer = 'stale';
    const changing: ToolDescriptor = {
      ...tool('get_task', () => ({ answer })),
      description: 'v1',
    };

    await registry.toolRegistry.sync([changing]);
    answer = 'fresh';
    // Same name, different descriptor identity: must be re-registered.
    await registry.toolRegistry.sync([{ ...changing, description: 'v2' }]);

    const result = (await ctx.executeTool('get_task', {})) as {
      content: { text: string }[];
      structuredContent: { answer: string };
    };
    expect(result.structuredContent.answer).toBe('fresh');
  });

  it('releases everything on releaseAll', async () => {
    await registry.toolRegistry.sync([tool('get_task')]);
    await registry.toolRegistry.releaseAll();

    expect(ctx.names()).toEqual([]);
    expect(registry.toolRegistry.getSnapshot().registered).toEqual([]);
  });

  it('survives a platform that refuses one registration', async () => {
    ctx.failNextRegister = true;

    await registry.toolRegistry.sync([tool('get_task'), tool('get_room')]);

    expect(ctx.names()).toEqual(['get_room']);
  });
});

describe('idempotence across re-renders and state changes', () => {
  it('does not re-register a tool whose behaviour is unchanged', async () => {
    await registry.toolRegistry.sync([tool('get_task'), tool('get_room')]);
    // New descriptor objects every render, same behaviour: the existing
    // registrations must be kept, not torn down and rebuilt.
    await registry.toolRegistry.sync([tool('get_task'), tool('get_room')]);
    await registry.toolRegistry.sync([tool('get_task'), tool('get_room')]);

    expect(ctx.registerCount('get_task')).toBe(1);
    expect(ctx.registerCount('get_room')).toBe(1);
  });

  it('re-registers only when the descriptor says its behaviour changed', async () => {
    const v1 = { ...tool('get_task', () => ({ for: 'task_1' })), syncKey: 'task_1' };
    await registry.toolRegistry.sync([v1]);
    // Same shape, different syncKey: the old handler would answer for the
    // wrong task, so the registration must be replaced.
    const v2 = { ...tool('get_task', () => ({ for: 'task_2' })), syncKey: 'task_2' };
    await registry.toolRegistry.sync([v2]);

    expect(ctx.registerCount('get_task')).toBe(2);
    const result = (await ctx.executeTool('get_task', {})) as {
      structuredContent: { for: string };
    };
    expect(result.structuredContent.for).toBe('task_2');
  });

  it('keeps stable tools untouched while gated tools come and go', async () => {
    // The task-screen pattern: state advances, verify_result appears, but
    // get_task was there the whole time and must not be re-registered.
    await registry.toolRegistry.sync([
      { ...tool('get_task'), syncKey: 'task_1' },
      { ...tool('stage_change'), syncKey: 'task_1' },
    ]);
    await registry.toolRegistry.sync([
      { ...tool('get_task'), syncKey: 'task_1' },
      { ...tool('verify_result'), syncKey: 'task_1' },
    ]);

    expect(ctx.names()).toEqual(['get_task', 'verify_result']);
    expect(ctx.registerCount('get_task')).toBe(1);
    expect(ctx.registerCount('stage_change')).toBe(1);
    expect(ctx.wasAborted('stage_change')).toBe(true);
  });
});

describe('slow platform removal after an abort', () => {
  // The dev-log bug: the platform drops an aborted tool asynchronously, and
  // `registerTool` refuses the name until it has. A registry that re-claims a
  // name on the strength of one microtask loses that race.

  it('replaces a tool without tripping over delayed removal', async () => {
    ctx.removalDelayMs = 30;
    const v1 = { ...tool('get_task', () => ({ answer: 'stale' })), syncKey: 'task_1' };
    await registry.toolRegistry.sync([v1]);

    const v2 = { ...tool('get_task', () => ({ answer: 'fresh' })), syncKey: 'task_2' };
    await registry.toolRegistry.sync([v2]);

    const result = (await ctx.executeTool('get_task', {})) as {
      structuredContent: { answer: string };
    };
    expect(result.structuredContent.answer).toBe('fresh');
    expect(ctx.names()).toEqual(['get_task']);
    // Replaced exactly once — no speculative re-registrations that happened
    // to survive, and no error swallowed along the way.
    expect(ctx.registerCount('get_task')).toBe(2);
  });

  it('re-registers after releaseAll even while the platform is still dropping the names', async () => {
    ctx.removalDelayMs = 30;
    await registry.toolRegistry.sync([tool('get_task'), tool('get_room')]);

    // The unmount→remount sequence: releaseAll is fire-and-forget on unmount,
    // and the next page's sync is queued behind it while the platform lags.
    const releasing = registry.toolRegistry.releaseAll();
    const resyncing = registry.toolRegistry.sync([tool('get_task'), tool('get_room')]);
    await Promise.all([releasing, resyncing]);

    expect(ctx.names()).toEqual(['get_task', 'get_room']);
    expect(ctx.registerCount('get_task')).toBe(2);
    expect(ctx.registerCount('get_room')).toBe(2);
  });

  it('still converges when removal never completes within the wait window', async () => {
    // Pathological platform: names stay listed forever. The registry warns,
    // presses on, and the retry still lands the tool rather than wedging.
    ctx.removalDelayMs = 60_000;
    const v1 = { ...tool('get_task'), syncKey: 'task_1' };
    await registry.toolRegistry.sync([v1]);

    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const v2 = { ...tool('get_task', () => ({ answer: 'fresh' })), syncKey: 'task_2' };
      const syncing = registry.toolRegistry.sync([v2]);
      // Past the poll interval and the removal timeout, in one step.
      await vi.advanceTimersByTimeAsync(10_000);
      await syncing;
      // The wait windows expired and were reported, not silently exceeded.
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      error.mockRestore();
      vi.useRealTimers();
    }

    // The platform itself never dropped the name, so the old registration is
    // what stands — but the registry settled and kept its bookkeeping
    // consistent with the platform's.
    expect(ctx.names()).toContain('get_task');
  });
});

describe('concurrent syncs and releases are serialised', () => {
  it('applies overlapping syncs in call order, not interleaved', async () => {
    ctx.removalDelayMs = 20;
    const first = registry.toolRegistry.sync([tool('get_task'), tool('get_room')]);
    const second = registry.toolRegistry.sync([tool('get_room'), tool('verify_result')]);
    await Promise.all([first, second]);

    // The last sync wins, and no name was registered twice.
    expect(ctx.names()).toEqual(['get_room', 'verify_result']);
    expect(ctx.registerCount('get_room')).toBe(1);
    expect(ctx.registerCount('verify_result')).toBe(1);
    expect(ctx.wasAborted('get_task')).toBe(true);
  });

  it('a release queued after a sync cannot leave the surface empty', async () => {
    // Route change: the old page's final sync is still queued when its
    // unmount release lands behind it. Order must hold.
    ctx.removalDelayMs = 20;
    const syncing = registry.toolRegistry.sync([tool('get_task')]);
    const releasing = registry.toolRegistry.releaseAll();
    await Promise.all([syncing, releasing]);

    expect(ctx.names()).toEqual([]);
    expect(registry.toolRegistry.getSnapshot().registered).toEqual([]);
  });
});

describe('call wrapping', () => {
  it('wraps plain object results in the MCP envelope', async () => {
    await registry.toolRegistry.sync([tool('get_task')]);

    const result = (await ctx.executeTool('get_task', {})) as {
      content: { type: string; text: string }[];
      structuredContent: { from: string };
    };

    expect(result.content).toEqual([
      { type: 'text', text: expect.stringContaining('"from": "get_task"') },
    ]);
    expect(result.structuredContent).toEqual({ from: 'get_task' });
    expect(result).not.toHaveProperty('isError', true);
  });

  it('returns an error envelope instead of rejecting when a handler throws', async () => {
    await registry.toolRegistry.sync([
      tool('boom', () => {
        throw new Error('reservation not found');
      }),
    ]);

    const result = (await ctx.executeTool('boom', {})) as {
      isError: boolean;
      content: { text: string }[];
    };

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('reservation not found');
  });

  it('records every call, most recent first', async () => {
    await registry.toolRegistry.sync([tool('get_task')]);
    await ctx.executeTool('get_task', { a: 1 });
    await ctx.executeTool('get_task', { b: 2 });

    const calls = registry.toolRegistry.getSnapshot().calls;

    expect(calls.map((c) => c.args)).toEqual([{ b: 2 }, { a: 1 }]);
    expect(calls.every((c) => c.outcome === 'ok' && c.durationMs >= 0)).toBe(true);
  });

  it('records failures with the message the agent was given', async () => {
    await registry.toolRegistry.sync([
      tool('boom', () => {
        throw new Error('reservation not found');
      }),
    ]);
    await ctx.executeTool('boom', {});

    const [call] = registry.toolRegistry.getSnapshot().calls;

    expect(call?.outcome).toBe('error');
    expect(call?.error).toBe('reservation not found');
  });

  it('caps the call log', async () => {
    await registry.toolRegistry.sync([tool('get_task')]);
    for (let i = 0; i < 205; i++) {
      await ctx.executeTool('get_task', { i });
    }

    expect(registry.toolRegistry.getSnapshot().calls).toHaveLength(200);
    expect(registry.toolRegistry.getSnapshot().calls[0]?.args).toEqual({ i: 204 });
  });
});

describe('invoke', () => {
  it('executes through the platform, the same path an agent uses', async () => {
    await registry.toolRegistry.sync([tool('get_task')]);

    const result = await registry.toolRegistry.invoke('get_task', { x: 1 });

    expect(result).toMatchObject({ structuredContent: { from: 'get_task' } });
  });

  it('fails helpfully when the tool is not registered', async () => {
    await registry.toolRegistry.sync([tool('get_task')]);

    await expect(registry.toolRegistry.invoke('commit_change')).rejects.toThrow(
      /not available right now/i,
    );
  });
});

describe('call provenance', () => {
  it('labels calls the page itself made as "page"', async () => {
    await registry.toolRegistry.sync([tool('get_task')]);

    await registry.toolRegistry.invoke('get_task', {});

    const [call] = registry.toolRegistry.getSnapshot().calls;
    expect(call?.source).toBe('page');
  });

  it('labels calls dispatched by the platform as "external"', async () => {
    await registry.toolRegistry.sync([tool('get_task')]);

    // What an agent in ChatGPT's in-app browser does: the platform calls the
    // tool, with no `invoke()` on our side.
    await ctx.executeTool('get_task', {});

    const [call] = registry.toolRegistry.getSnapshot().calls;
    expect(call?.source).toBe('external');
  });
});
