/**
 * Lifecycle-aware WebMCP tool registry.
 *
 * Two jobs, both of which matter to Proof's thesis:
 *
 * 1. **Gating.** The set of registered tools is derived from task state, so an
 *    agent cannot call `verify_result` before anything has been committed — the
 *    tool is genuinely absent, not merely guarded. `sync()` diffs the desired
 *    set against what is registered and registers/aborts to converge, firing
 *    the platform's `toolchange` event as a side effect of each change.
 *
 * 2. **Observation.** Every call is wrapped so the inspector can show exactly
 *    what the agent asked for and what the page returned, and so every result
 *    leaves as the same MCP-style envelope regardless of what the underlying
 *    handler returned.
 *
 * The registry never mutates application state itself. It only routes calls to
 * handlers supplied by `webmcp/tools`, which in turn may only reach the server
 * through the documented route handlers.
 */

import { ensureModelContext, type WebMCPMode } from './adapter';
import type { ModelContext, ToolDescriptor, ToolResult } from './types';

export interface ToolCallRecord {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  startedAt: string;
  durationMs: number;
  outcome: 'ok' | 'error';
  /** Present on success: the structured payload the tool produced. */
  result?: unknown;
  /** Present on failure: the message the agent was given. */
  error?: string;
}

export interface RegistrySnapshot {
  mode: WebMCPMode;
  ready: boolean;
  /** Names currently registered, in registration order. */
  registered: readonly string[];
  /** Most recent call first. */
  calls: readonly ToolCallRecord[];
}

const MAX_CALL_LOG = 200;

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Coerces whatever a handler returned into the MCP envelope.
 *
 * Handlers in this codebase return plain objects; the text block is what a
 * language model actually reads, so it gets a compact JSON rendering while the
 * structured payload is preserved alongside it for richer clients.
 */
function toEnvelope(value: unknown): ToolResult {
  if (
    value !== null &&
    typeof value === 'object' &&
    'content' in value &&
    Array.isArray((value as ToolResult).content)
  ) {
    return value as ToolResult;
  }

  const text =
    typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2);

  return { content: [{ type: 'text', text }], structuredContent: value };
}

function errorEnvelope(message: string): ToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
    structuredContent: { error: message },
  };
}

class ToolRegistry {
  #mode: WebMCPMode = 'unavailable';
  #ready = false;
  #ctx: ModelContext | null = null;
  #controllers = new Map<string, AbortController>();
  #order: string[] = [];
  #calls: ToolCallRecord[] = [];
  #listeners = new Set<() => void>();
  #snapshot: RegistrySnapshot = {
    mode: 'unavailable',
    ready: false,
    registered: [],
    calls: [],
  };
  #initialising: Promise<void> | null = null;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = (): RegistrySnapshot => this.#snapshot;

  #publish(): void {
    this.#snapshot = {
      mode: this.#mode,
      ready: this.#ready,
      registered: [...this.#order],
      calls: [...this.#calls],
    };
    for (const listener of this.#listeners) listener();
  }

  #record(record: ToolCallRecord): void {
    this.#calls = [record, ...this.#calls].slice(0, MAX_CALL_LOG);
    this.#publish();
  }

  async init(): Promise<void> {
    if (this.#ready) return;
    if (this.#initialising) return this.#initialising;

    this.#initialising = (async () => {
      const env = await ensureModelContext();
      this.#mode = env.mode;
      this.#ctx = env.modelContext;
      this.#ready = env.modelContext !== null;
      this.#publish();
    })();

    return this.#initialising;
  }

  /**
   * Wraps a handler so failures reach the agent as a readable error instead of
   * an unhandled rejection, and so every call lands in the inspector's log.
   */
  #wrap(descriptor: ToolDescriptor): ToolDescriptor {
    return {
      ...descriptor,
      execute: async (args: Record<string, unknown> = {}) => {
        const id = newId();
        const startedAt = new Date().toISOString();
        const t0 = performance.now();

        try {
          const raw = await descriptor.execute(args ?? {});
          const envelope = toEnvelope(raw);
          this.#record({
            id,
            tool: descriptor.name,
            args: args ?? {},
            startedAt,
            durationMs: Math.round(performance.now() - t0),
            outcome: envelope.isError ? 'error' : 'ok',
            result: envelope.structuredContent ?? raw,
          });
          return envelope;
        } catch (cause) {
          const message =
            cause instanceof Error ? cause.message : `Tool failed: ${String(cause)}`;
          this.#record({
            id,
            tool: descriptor.name,
            args: args ?? {},
            startedAt,
            durationMs: Math.round(performance.now() - t0),
            outcome: 'error',
            error: message,
          });
          // Returned rather than thrown: an agent can act on a message, but a
          // rejected promise surfaces inconsistently across implementations.
          return errorEnvelope(message);
        }
      },
    };
  }

  async #register(descriptor: ToolDescriptor): Promise<void> {
    if (!this.#ctx) return;

    const controller = new AbortController();
    try {
      await this.#ctx.registerTool(this.#wrap(descriptor), { signal: controller.signal });
      this.#controllers.set(descriptor.name, controller);
      if (!this.#order.includes(descriptor.name)) this.#order.push(descriptor.name);
    } catch (cause) {
      // A failed registration must not take the rest of the tool surface down.
      console.error(`[webmcp] could not register "${descriptor.name}"`, cause);
    }
  }

  #unregister(name: string): void {
    const controller = this.#controllers.get(name);
    if (!controller) return;
    controller.abort();
    this.#controllers.delete(name);
    this.#order = this.#order.filter((n) => n !== name);
  }

  /**
   * Converges the registered tool set onto `descriptors`.
   *
   * Re-registers a tool whose descriptor changed, because handlers close over
   * task state and a stale closure would answer with stale data.
   */
  async sync(descriptors: readonly ToolDescriptor[]): Promise<void> {
    await this.init();
    if (!this.#ctx) return;

    const desired = new Map(descriptors.map((d) => [d.name, d]));

    for (const name of [...this.#controllers.keys()]) {
      if (!desired.has(name)) this.#unregister(name);
    }

    for (const [name, descriptor] of desired) {
      if (this.#controllers.has(name)) {
        // Replace so the handler's captured state is current. Yield once so the
        // abort-driven unregister settles before the name is claimed again.
        this.#unregister(name);
        await Promise.resolve();
      }
      await this.#register(descriptor);
    }

    this.#publish();
  }

  /** Releases every tool. Used on unmount and by tests. */
  async releaseAll(): Promise<void> {
    for (const name of [...this.#controllers.keys()]) this.#unregister(name);
    this.#publish();
  }

  /**
   * Executes a tool through the platform, exactly as an external agent would.
   * The built-in pilot uses this so the local demo path exercises the real tool
   * surface rather than calling handlers directly.
   */
  async invoke(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    await this.init();
    if (!this.#ctx) throw new Error('WebMCP is not available in this browser.');

    const tools = await this.#ctx.getTools();
    const tool = tools.find((t) => t.name === name);
    if (!tool) {
      throw new Error(
        `Tool "${name}" is not available right now. Available: ${tools
          .map((t) => t.name)
          .join(', ')}`,
      );
    }
    return this.#ctx.executeTool(tool, args);
  }

  /** Reads the tool list back from the platform, for the inspector. */
  async listPlatformTools() {
    await this.init();
    if (!this.#ctx) return [];
    return this.#ctx.getTools();
  }
}

/** Single registry per document. */
export const toolRegistry = new ToolRegistry();
