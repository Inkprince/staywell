/**
 * The invariants (security principles).
 *
 * These are the guards the route handlers call *before* doing anything. Each
 * one encodes a property the product promises, so a violation is a loud,
 * named error — never a silent no-op and never a best-effort continue.
 *
 * Structural note: approval and commit are reachable only through code that
 * imports this module — server-side route handlers. Nothing under
 * `src/webmcp/` imports it, and `tests/boundaries.test.ts` enforces that.
 */

import { assertCurrentRevision } from './revisions';
import { canTransition, transition, type TaskEvent } from './state-machine';
import type { ProofTask } from './task';

export class PolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PolicyError';
  }
}

export function getTask(taskId: string, tasks: readonly ProofTask[]): ProofTask {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) throw new PolicyError(`no task "${taskId}"`);
  return task;
}

/** Only the human's click, carrying an unconsumed nonce, may approve. */
export function assertApprovable(task: ProofTask, nonceConsumed: boolean): void {
  if (!canTransition(task.state, 'approve')) {
    throw new PolicyError(
      `task "${task.id}" is ${task.state}; only a staged change awaiting review can be approved`,
    );
  }
  if (nonceConsumed) {
    throw new PolicyError('this approval link has already been used');
  }
  if (!task.staged) {
    throw new PolicyError('nothing is staged for approval');
  }
}

/** Commit follows approval. Always. */
export function assertCommittable(task: ProofTask): void {
  if (task.state !== 'APPROVED') {
    throw new PolicyError(
      `task "${task.id}" is ${task.state}; a change may only be committed after it is approved`,
    );
  }
}

/**
 * Verification reads fresh state — a result computed against a revision the
 * task has since moved past must never be recorded.
 */
export function assertVerificationFresh(task: ProofTask, revision: number): void {
  assertCurrentRevision(revision, task.revision);
  if (task.state !== 'VERIFYING') {
    throw new PolicyError(
      `task "${task.id}" is ${task.state}; reality is only checked after a change has been applied`,
    );
  }
}

/**
 * Applies `event` to the task's state, throwing a PolicyError (rather than the
 * raw IllegalTransitionError) so callers always get a product-voiced message.
 */
export function step(task: ProofTask, event: TaskEvent): ProofTask {
  try {
    return { ...task, state: transition(task.state, event) };
  } catch (cause) {
    throw new PolicyError(
      cause instanceof Error ? cause.message : `cannot move task "${task.id}"`,
    );
  }
}
