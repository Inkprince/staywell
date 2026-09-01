/**
 * The workspace store, in-memory.
 *
 * This is the in-memory stand-in: the shape of the data (one workspace = one
 * world + its tasks + its audit log) is exactly what the Postgres migrations
 * will model, and every consumer goes through the same accessors, so swapping
 * this for the Supabase store later is a change *here*, not across the app.
 *
 * Until then: single process, no persistence. Honest about it, and nothing
 * agent-facing ever gets a handle on the store — only route handlers do.
 */

import type { AuditEvent } from '@/lib/proof/audit';
import type { ApprovalNonce, ProofTask } from '@/lib/proof/task';
import { createWorld, type StayWellWorld } from '@/lib/staywell/world';

export interface Workspace {
  id: string;
  seed: number;
  /** The StayWell simulation state; the only source of hotel truth. */
  world: StayWellWorld;
  tasks: ProofTask[];
  nonces: ApprovalNonce[];
  audit: AuditEvent[];
  taskCounter: number;
}

/**
 * The demo seed. Verified by the seed scan: the quote the human reviews says
 * $294 (busy pricing), and the commit — after competing demand lands between
 * staging and approval — reprices to $319 by the same formula. Emergent, not
 * theatrical. ~13% of seeds mismatch (40/300), so clean successes are easy to
 * find too; `?seed=` walks any of them.
 */
export const DEFAULT_DEMO_SEED = 4;

export class MemoryStore {
  #workspaces = new Map<string, Workspace>();

  createWorkspace(id: string, seed: number = DEFAULT_DEMO_SEED): Workspace {
    if (this.#workspaces.has(id)) {
      throw new Error(`workspace "${id}" already exists`);
    }

    const workspace: Workspace = {
      id,
      seed,
      world: createWorld(seed),
      tasks: [],
      nonces: [],
      audit: [],
      taskCounter: 0,
    };

    this.#workspaces.set(id, workspace);
    return workspace;
  }

  getWorkspace(id: string): Workspace | undefined {
    return this.#workspaces.get(id);
  }

  putWorkspace(workspace: Workspace): void {
    this.#workspaces.set(workspace.id, workspace);
  }
}

/** The app-wide instance. Server code only. */
export const memoryStore = new MemoryStore();
