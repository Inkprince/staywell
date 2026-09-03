/**
 * A controllable stand-in for `document.modelContext`.
 *
 * Mirrors the behaviours the real surface promises: registration with an
 * AbortSignal-scoped lifetime, `getTools()` reading back the live set, and
 * `executeTool()` dispatching by name. Tests drive this directly to observe
 * what an agent would have seen.
 *
 * It also mirrors two behaviours the real platform has and a naive fake
 * doesn't — both of which once shipped real bugs:
 *
 * - `registerTool` **refuses a name that is still registered**, with the same
 *   `InvalidStateError` the platform throws.
 * - abort-driven removal can be made to **lag** (`removalDelayMs`), because
 *   the platform drops an aborted tool on its own schedule, not ours.
 */

import type {
  ModelContext,
  RegisteredTool,
  RegisterToolOptions,
  ToolDescriptor,
} from '@/webmcp/types';

interface Entry {
  tool: ToolDescriptor;
  signal: AbortSignal;
}

export class FakeModelContext extends EventTarget implements ModelContext {
  #entries = new Map<string, Entry>();
  #aborted = new Set<string>();
  #registerCounts = new Map<string, number>();
  /** Set to make `registerTool` reject, simulating a platform failure. */
  failNextRegister = false;
  /**
   * How long an aborted tool lingers in the platform's list before removal.
   * The real removal is asynchronous; this reproduces that lag on demand.
   */
  removalDelayMs = 0;

  async registerTool(tool: ToolDescriptor, options?: RegisterToolOptions): Promise<void> {
    this.#registerCounts.set(tool.name, (this.#registerCounts.get(tool.name) ?? 0) + 1);

    // The platform owns the name: still listed means refused, exactly like the
    // real implementation ("Tool "x" is already registered").
    if (this.#entries.has(tool.name)) {
      throw new DOMException(`Tool "${tool.name}" is already registered`, 'InvalidStateError');
    }

    if (this.failNextRegister) {
      this.failNextRegister = false;
      throw new Error('platform refused the registration');
    }

    // The platform owns the signal's meaning: aborted means unregistered —
    // immediately, or after `removalDelayMs`, depending on what is being
    // reproduced.
    const controller = new AbortController();
    const entry: Entry = { tool, signal: controller.signal };
    controller.signal.addEventListener(
      'abort',
      () => {
        this.#aborted.add(tool.name);
        const remove = () => {
          if (this.#entries.get(tool.name) === entry) {
            this.#entries.delete(tool.name);
          }
        };
        if (this.removalDelayMs > 0) {
          setTimeout(remove, this.removalDelayMs);
        } else {
          remove();
        }
      },
      { once: true },
    );
    if (options?.signal) {
      if (options.signal.aborted) {
        // Registered with an already-aborted signal: never appears.
        return;
      }
      options.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    this.#entries.set(tool.name, entry);
  }

  async getTools(): Promise<RegisteredTool[]> {
    return [...this.#entries.values()].map(({ tool }) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      origin: window.location.origin,
    }));
  }

  async executeTool(
    tool: RegisteredTool | string,
    args: Record<string, unknown> = {},
  ): Promise<unknown> {
    const name = typeof tool === 'string' ? tool : tool.name;
    const entry = this.#entries.get(name);
    if (!entry || entry.signal.aborted) {
      throw new Error(`tool "${name}" is not registered`);
    }
    return entry.tool.execute(args);
  }

  names(): string[] {
    return [...this.#entries.keys()];
  }

  /** How many times `registerTool` was called with this name. */
  registerCount(name: string): number {
    return this.#registerCounts.get(name) ?? 0;
  }

  /** True when the entry existed and was removed by an abort. */
  wasAborted(name: string): boolean {
    return this.#aborted.has(name);
  }
}
