/**
 * The one shape of a task that leaves the server — used by every route that
 * returns a task, so the tool surface, the task screen, and the receipt all
 * render from the same fields.
 *
 * Notably excludes approval nonces and store internals: this view is what
 * agents see too, so nothing private can leak through it.
 */

import type { ProofTask } from '@/lib/proof/task';

export function taskView(task: ProofTask) {
  return {
    id: task.id,
    goal: task.goal,
    state: task.state,
    revision: task.revision,
    constraints: task.constraints,
    staged: task.staged
      ? {
          id: task.staged.id,
          request: task.staged.request,
          /** The world as it was when the change was staged — the "Before". */
          before: task.staged.before,
          quote: task.staged.quote,
          rationale: task.staged.rationale ?? null,
          baseRevision: task.staged.baseRevision,
          stagedAt: task.staged.stagedAt,
        }
      : null,
    verification: task.verification
      ? {
          matched: task.verification.result.matched,
          verdicts: task.verification.result.verdicts,
          unexpectedChanges: task.verification.result.unexpectedChanges,
          checkedAt: task.verification.verifiedAt,
        }
      : null,
    approved: task.approvals.length > 0,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

/** The TypeScript shape of `taskView`'s output, for the client screens. */
export type PublicTask = ReturnType<typeof taskView>;
