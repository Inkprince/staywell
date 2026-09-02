/**
 * Type definitions for the WebMCP API surface (`document.modelContext`).
 *
 * Mirrors the explainer at https://github.com/webmachinelearning/webmcp. These are
 * declared locally rather than pulled from a published package so that the exact
 * shape Proof codes against is visible and reviewable inside this repository.
 */

/** The subset of JSON Schema that WebMCP tool input schemas use. */
export type JSONSchema = {
  type?: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'null';
  description?: string;
  properties?: Record<string, JSONSchema>;
  required?: readonly string[];
  items?: JSONSchema;
  enum?: readonly unknown[];
  const?: unknown;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
  oneOf?: readonly JSONSchema[];
  additionalProperties?: boolean | JSONSchema;
};

/** A single content block in an MCP-style tool result. */
export type ToolContentBlock = { type: 'text'; text: string };

/**
 * The envelope Proof returns from every tool. The spec permits returning raw
 * values, but always emitting the MCP-style envelope keeps behaviour identical
 * across the native implementation, the polyfill, and the server-side pilot.
 */
export type ToolResult = {
  content: ToolContentBlock[];
  /** Machine-readable payload. Agents that only read `content` still work. */
  structuredContent?: unknown;
  isError?: boolean;
};

/** A tool as handed to `registerTool`. */
export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema?: JSONSchema;
  annotations?: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => unknown | Promise<unknown>;
}

/** A tool as returned by `getTools()`. */
export interface RegisteredTool {
  name: string;
  description: string;
  inputSchema?: JSONSchema;
  origin: string;
}

export interface RegisterToolOptions {
  signal?: AbortSignal;
  exposedTo?: string[];
}

export interface ModelContext extends EventTarget {
  registerTool(tool: ToolDescriptor, options?: RegisterToolOptions): Promise<void>;
  getTools(options?: { fromOrigins?: string[] }): Promise<RegisteredTool[]>;
  executeTool(
    tool: RegisteredTool | string,
    args?: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ): Promise<unknown>;
}

declare global {
  interface Document {
    modelContext?: ModelContext;
  }
  interface Navigator {
    /** Present in some pre-standard builds; see `adapter.ts`. */
    modelContext?: ModelContext;
  }
}
