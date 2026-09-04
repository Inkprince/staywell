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
 * Two platform facts shape the lifecycle, both learned the hard way:
 *
 * - `registerTool` throws `InvalidStateError` if the name is already
 *   registered — and the platform's abort-driven *removal* is asynchronous.
 *   Aborting a tool's signal and immediately re-registering the same name is a
 *   race the page loses. So the registry never re-registers a tool whose
 *   behaviour is unchanged, and when a name genuinely must be replaced it
 *   waits for `getTools()` to stop listing it before claiming it again.
 * - Route changes, React re-renders, and StrictMode double-mounts all produce
 *   bursts of `sync()`/`releaseAll()` calls. They are serialised through one
 *   queue, so the registry's view and the platform's can never interleave.
 *
 * The registry never mutates application state itself. It only routes calls to
 * handlers supplied by `webmcp/tools`, which in turn may only reach the server
 * through the documented route handlers.
 */

import { ensureModelContext, type WebMCPMode } from './adapter';
import type { ModelContext, ToolDescriptor, ToolResult } from './types';

/** Who caused a tool call, as best the page can tell. */
export type CallSource = 'external' | 'page';

export interface ToolCallRecord {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  startedAt: string;
  durationMs: number;
  outcome: 'ok' | 'error';
  /**
   * 'external' — the platform dispatched the call (an agent in ChatGPT's
   * in-app browser, or anything else on the other side of WebMCP).
   * 'page' — this page invoked it through `invoke()` (a self-test, an
   * in-page demo). Labelled so the inspector never passes our own calls off
   * as an external agent's.
   */
  source: CallSource;
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

/** How often to ask the platform whether an aborted name has been dropped. */
const REMOVAL_POLL_MS = 25;
/** How long to wait for an aborted name to disappear before pressing on. */
const REMOVAL_TIMEOUT_MS = 4000;

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The platform's "name already taken" refusal. Matched by name *and* message
 * so both the native implementation and the vendored polyfill are covered.
 */
function isAlreadyRegistered(cause: unknown): boolean {
  if (cause instanceof DOMException && cause.name === 'InvalidStateError') return true;
  return cause instanceof Error && cause.message.includes('is already registered');
}

/**
 * Everything about a descriptor that a re-registration could change. Two
 * descriptors with the same signature are assumed to behave identically (see
 * `ToolDescriptor.syncKey`), so the existing registration is kept.
 */
function signatureFor(descriptor: ToolDescriptor): string {
  return JSON.stringify([
    descriptor.name,
    descriptor.syncKey ?? '',
    descriptor.description,
    descriptor.inputSchema ?? null,
    descriptor.annotations ?? null,
  ]);
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

interface Registration {
  controller: AbortController;
  signature: string;
}

class ToolRegistry {
  #mode: WebMCPMode = 'unavailable';
  #ready = false;
  #ctx: ModelContext | null = null;
  #entries = new Map<string, Registration>();
  #calls: ToolCallRecord[] = [];
  #listeners = new Set<() => void>();
  #snapshot: RegistrySnapshot = {
    mode: 'unavailable',
    ready: false,
    registered: [],
    calls: [],
  };
  #initialising: Promise<void> | null = null;
  /**
   * Every mutation of the registered set runs through here, in call order.
   * Concurrent `sync()`/`releaseAll()` calls therefore apply one after another
   * instead of interleaving their aborts and registrations.
   */
  #queue: Promise<unknown> = Promise.resolve();
  /** In-flight `invoke()` calls, for labelling call-log entries (see `#wrap`). */
  #pageInvocations = 0;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = (): RegistrySnapshot => this.#snapshot;

  #publish(): void {
    this.#snapshot = {
      mode: this.#mode,
      ready: this.#ready,
      registered: [...this.#entries.keys()],
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

  #enqueue<T>(work: () => Promise<T>): Promise<T> {
    // `work` runs whether the previous queued step succeeded or failed; a
    // failed sync must not wedge the queue for the next route.
    const run = this.#queue.then(work, work);
    this.#queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
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
        // Captured synchronously at dispatch: `invoke()` sets the counter for
        // the duration of its `executeTool` call, and platforms dispatch the
        // handler within it. A call arriving from outside the page finds the
        // counter at zero.
        const source: CallSource = this.#pageInvocations > 0 ? 'page' : 'external';

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
            source,
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
            source,
            error: message,
          });
          // Returned rather than thrown: an agent can act on a message, but a
          // rejected promise surfaces inconsistently across implementations.
          return errorEnvelope(message);
        }
      },
    };
  }

  /**
   * Asks the platform to drop `names`, polling `getTools()` until it has.
   *
   * Aborting a registration's signal is only a *request* — the platform
   * removes the tool on its own schedule, and `registerTool` refuses the name
   * until it has. Reading the tool list back is the only way to observe that,
   * so that is exactly what this waits for.
   */
  async #waitForRemoval(names: readonly string[]): Promise<void> {
    if (!this.#ctx || names.length === 0) return;

    const pending = new Set(names);
    const deadline = Date.now() + REMOVAL_TIMEOUT_MS;

    for (;;) {
      try {
        const tools = await this.#ctx.getTools();
        // Only our own registrations can block us: a same-named tool from
        // another origin is not ours to wait for.
        const held = new Set(
          tools
            .filter((tool) => !tool.origin || tool.origin === window.location.origin)
            .map((tool) => tool.name),
        );
        for (const name of [...pending]) {
          if (!held.has(name)) pending.delete(name);
        }
        if (pending.size === 0) return;
      } catch {
        // The list is unreadable; the retry in `#register` is the backstop.
        return;
      }

      if (Date.now() >= deadline) {
        console.warn(
          `[webmcp] the platform still lists [${[...pending].join(', ')}] shortly after they were released; continuing`,
        );
        return;
      }

      await delay(REMOVAL_POLL_MS);
    }
  }

  async #register(descriptor: ToolDescriptor): Promise<void> {
    if (!this.#ctx) return;

    // Canonical WebMCP form (per the challenge rules):
    // document.modelContext.registerTool({ name, description, inputSchema, execute }, { signal })
    // `this.#ctx` below IS that document.modelContext (or its polyfill), resolved in adapter.ts.
    const signature = signatureFor(descriptor);
    const register = () => {
      const controller = new AbortController();
      return {
        controller,
        promise: this.#ctx!.registerTool(this.#wrap(descriptor), {
          signal: controller.signal,
        }),
      };
    };

    let attempt = register();
    try {
      await attempt.promise;
    } catch (cause) {
      if (!isAlreadyRegistered(cause)) {
        // A failed registration must not take the rest of the tool surface down.
        console.error(`[webmcp] could not register "${descriptor.name}"`, cause);
        return;
      }
      // The name is still held — an aborted predecessor the platform has not
      // dropped yet (its removal is asynchronous). Wait for the drop, then
      // claim the name once more; this is the one retry that makes
      // unregister→re-register safe.
      await this.#waitForRemoval([descriptor.name]);
      attempt = register();
      try {
        await attempt.promise;
      } catch (retryCause) {
        console.error(`[webmcp] could not register "${descriptor.name}"`, retryCause);
        return;
      }
    }

    this.#entries.set(descriptor.name, { controller: attempt.controller, signature });
  }

  #abort(name: string, registration: Registration): void {
    registration.controller.abort();
    this.#entries.delete(name);
  }

  async #sync(descriptors: readonly ToolDescriptor[]): Promise<void> {
    await this.init();
    if (!this.#ctx) return;

    const desired = new Map(descriptors.map((d) => [d.name, d]));

    // Names the platform must drop before anything may claim them again:
    // tools that left the set, plus tools whose behaviour changed and are
    // therefore about to be replaced.
    const released: string[] = [];

    for (const [name, registration] of [...this.#entries]) {
      const next = desired.get(name);
      if (!next) {
        this.#abort(name, registration);
        released.push(name);
      } else if (signatureFor(next) !== registration.signature) {
        this.#abort(name, registration);
        released.push(name);
      }
    }

    if (released.length > 0) await this.#waitForRemoval(released);

    for (const descriptor of desired.values()) {
      // Unchanged registrations are kept as-is: no unregister, no re-register.
      // This is what makes `sync()` idempotent across re-renders, task state
      // changes, and StrictMode double-mounts.
      if (this.#entries.has(descriptor.name)) continue;
      await this.#register(descriptor);
    }

    this.#publish();
  }

  /**
   * Converges the registered tool set onto `descriptors`.
   *
   * Re-registers only a tool whose behaviour changed (see `ToolDescriptor`
   * .syncKey) — handlers read application state at call time, so an unchanged
   * descriptor would answer exactly like the one already registered, and
   * replacing it would only churn the surface. Queued behind any in-flight
   * sync or release, so concurrent callers apply in order.
   */
  async sync(descriptors: readonly ToolDescriptor[]): Promise<void> {
    return this.#enqueue(() => this.#sync(descriptors));
  }

  /**
   * Releases every tool and waits for the platform to confirm the drop.
   * Used on unmount and by tests. A `sync()` queued behind this one (the next
   * page mounting, say) will not race the removals.
   */
  async releaseAll(): Promise<void> {
    return this.#enqueue(async () => {
      const names = [...this.#entries.keys()];
      for (const [name, registration] of [...this.#entries]) {
        this.#abort(name, registration);
      }
      await this.#waitForRemoval(names);
      this.#publish();
    });
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
    this.#pageInvocations++;
    try {
      return await this.#ctx.executeTool(tool, args);
    } finally {
      this.#pageInvocations--;
    }
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
