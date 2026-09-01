/**
 * A controllable stand-in for `document.modelContext`.
 *
 * Mirrors the behaviours the real surface promises: registration with an
 * AbortSignal-scoped lifetime, `getTools()` reading back the live set, and
 * `executeTool()` dispatching by name. Tests drive this directly to observe
 * what an agent would have seen.
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
  /** Set to make `registerTool` reject, simulating a platform failure. */
  failNextRegister = false;

  async registerTool(tool: ToolDescriptor, options?: RegisterToolOptions): Promise<void> {
    if (this.failNextRegister) {
      this.failNextRegister = false;
      throw new Error('platform refused the registration');
    }

    // The platform owns the signal's meaning: aborted means unregistered,
    // immediately and silently, exactly like the real implementation.
    const controller = new AbortController();
    const entry: Entry = { tool, signal: controller.signal };
    controller.signal.addEventListener(
      'abort',
      () => {
        this.#aborted.add(tool.name);
        if (this.#entries.get(tool.name) === entry) {
          this.#entries.delete(tool.name);
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

  /** True when the entry existed and was removed by an abort. */
  wasAborted(name: string): boolean {
    return this.#aborted.has(name);
  }
}
