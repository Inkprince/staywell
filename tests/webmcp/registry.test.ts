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
