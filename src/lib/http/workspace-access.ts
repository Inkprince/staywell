/**
 * The server-side bridge between HTTP and the workspace store.
 *
 * Route handlers call `workspaceFor(request)` and never touch the store
 * directly, so the session rules (cookie, `?w=`, mint-on-first-use) are
 * defined exactly once. The memory store is the in-memory stand-in; when the
 * Supabase store lands, this is the one module that changes.
 */

import { resolveWorkspaceId } from '@/lib/session';
import { DEFAULT_DEMO_SEED, memoryStore, type Workspace } from '@/lib/store/memory';

export class WorkspaceError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'WorkspaceError';
  }
}

export interface ResolvedWorkspace {
  workspace: Workspace;
  /** True when this request minted the workspace (cookie is set by the route). */
  minted: boolean;
}

/**
 * Resolves the workspace for a request, creating it when it does not exist.
 * A `?seed=` is honoured only at mint time.
 */
export function workspaceFor(request: Request): ResolvedWorkspace {
  const { workspaceId, minted, seed } = resolveWorkspaceId(request);
  const existing = memoryStore.getWorkspace(workspaceId);

  if (existing) return { workspace: existing, minted: false };

  const workspace = memoryStore.createWorkspace(workspaceId, seed ?? DEFAULT_DEMO_SEED);
  return { workspace, minted: true };
}

/** Read-only variant: no minting, errors instead. */
export function existingWorkspaceFor(request: Request): Workspace {
  const { workspaceId } = resolveWorkspaceId(request);
  const workspace = memoryStore.getWorkspace(workspaceId);
  if (!workspace) {
    throw new WorkspaceError('no workspace for this session — start one at /workspace', 404);
  }
  return workspace;
}

/** Persists a workspace after a mutation. */
export function saveWorkspace(workspace: Workspace): void {
  memoryStore.putWorkspace(workspace);
}
