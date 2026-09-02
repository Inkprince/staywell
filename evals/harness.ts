/**
 * The eval harness: a workspace driven through the same
 * transaction functions the route handlers call, with every consequential
 * attempt recorded so the report can carry measured numbers.
 *
 * The `agent` methods are exactly what the tool surface can reach. The
 * `human` methods are exactly what the routes gate behind the browser. If a
 * scenario needs an agent to attempt something it should never be able to do,
 * it calls the agent method and asserts the refusal.
 */

import {
  abandonTask,
  acceptResult,
  approveChange,
  commitStaged,
  declineStaged,
  getQuote,
  issueApprovalNonce,
  setConstraints,
  stageChange,
  stageRecovery,
  startTask,
  snapshotOf,
  verifyResult,
} from '@/lib/proof/transaction';
import { findRecoveryOptions } from '@/lib/proof/recovery';
import { verify } from '@/lib/proof/verifier';
import type { Constraint } from '@/lib/proof/constraints';
import { MemoryStore, type Workspace } from '@/lib/store/memory';

export interface Metrics {
  tasksCreated: number;
  commitsApplied: number;
  mismatchesCaught: number;
  falseCompletions: number;
  agentCommitAttempts: number;
  agentCommitRejected: number;
  agentApproveAttempts: number;
  agentApproveRejected: number;
  stalePlanAttempts: number;
  stalePlanRejected: number;
}

export function freshMetrics(): Metrics {
  return {
    tasksCreated: 0,
    commitsApplied: 0,
    mismatchesCaught: 0,
    falseCompletions: 0,
    agentCommitAttempts: 0,
    agentCommitRejected: 0,
    agentApproveAttempts: 0,
    agentApproveRejected: 0,
    stalePlanAttempts: 0,
    stalePlanRejected: 0,
  };
}

export type Stay = {
  reservationId: string;
  roomId: string;
  checkIn: string;
  nights: number;
};

export type Attempt<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: string; stale?: boolean };

const FRIDAY = '2026-09-04';

/** The canonical demo ask. */
export const CANONICAL_CONSTRAINTS: Constraint[] = [
  { kind: 'date_equals', date: FRIDAY },
  { kind: 'room_equals', roomId: '418' },
  { kind: 'price_at_most', amount: 300 },
];

export const CANONICAL_GOAL =
  'Move my reservation to Friday, keep the same room, and stay under $300.';

export const CANONICAL_STAY: Stay = {
  reservationId: 'res_18',
  roomId: '418',
  checkIn: FRIDAY,
  nights: 2,
};

function asAttempt<T>(run: () => T): Attempt<T> {
  try {
    return { ok: true, value: run() };
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : 'refused';
    return { ok: false, error, stale: error.includes('moved on') };
  }
}

export class Site {
  workspace: Workspace;
  taskId: string;
  private consumedNonceId: string | null = null;

  constructor(
    private readonly metrics: Metrics,
    seed: number,
    goal: string,
  ) {
    this.workspace = new MemoryStore().createWorkspace(`ws_eval_${Math.random()}`, seed);
    const started = startTask(this.workspace, goal);
    this.workspace = started.workspace;
    this.taskId = started.task.id;
    metrics.tasksCreated += 1;
  }

  get task() {
    return this.workspace.tasks.find((t) => t.id === this.taskId)!;
  }

  get state() {
    return this.task.state;
  }

  get reservation() {
    return this.workspace.world.reservations[0]!;
  }

  // -- The agent surface ----------------------------------------------------

  agentSetGoal(constraints: Constraint[], baseRevision?: number): Attempt {
    return asAttempt(() => {
      this.workspace = setConstraints(
        this.workspace,
        this.taskId,
        constraints,
        baseRevision ?? this.workspace.world.revision,
      );
    });
  }

  agentQuote(stay: Stay): Attempt<{ totalDollars: number }> {
    return asAttempt(() => getQuote(this.workspace, this.taskId, stay).quote);
  }

  agentStage(
    stay: Stay,
    options: { rationale?: string; baseRevision?: number } = {},
  ): Attempt {
    const revision = options.baseRevision ?? this.workspace.world.revision;
    const attempt = asAttempt(() => {
      this.workspace = stageChange(this.workspace, this.taskId, stay, {
        rationale: options.rationale,
        baseRevision: revision,
      }).workspace;
    });
    if (!attempt.ok && attempt.stale) {
      this.metrics.stalePlanAttempts += 1;
      this.metrics.stalePlanRejected += 1;
    }
    return attempt;
  }

  /** An agent "committing" the change itself — must always be refused. */
  agentCommit(): Attempt {
    this.metrics.agentCommitAttempts += 1;
    const attempt = asAttempt(() => {
      this.workspace = commitStaged(this.workspace, this.taskId).workspace;
    });
    if (!attempt.ok) this.metrics.agentCommitRejected += 1;
    return attempt;
  }

  /** An agent "approving" — with or without a real nonce — always refused. */
  agentApprove(nonceId?: string): Attempt {
    this.metrics.agentApproveAttempts += 1;
    const attempt = asAttempt(() => {
      this.workspace = approveChange(this.workspace, this.taskId, nonceId ?? 'nonce_forged')
        .workspace;
    });
    if (!attempt.ok) this.metrics.agentApproveRejected += 1;
    return attempt;
  }

  agentVerify(): Attempt<boolean> {
    return asAttempt(() => {
      const verified = verifyResult(this.workspace, this.taskId);
      this.workspace = verified.workspace;
      return verified.verification.matched;
    });
  }

  agentFindRecovery() {
    return findRecoveryOptions(this.workspace, this.taskId);
  }

  agentStageRecovery(optionId: string): Attempt {
    const option = this.agentFindRecovery().find((o) => o.id === optionId);
    if (!option || !option.request) return { ok: false, error: 'no such option' };
    return asAttempt(() => {
      this.workspace = stageRecovery(this.workspace, this.taskId, {
        request: option.request!,
        summary: option.summary,
      }).workspace;
    });
  }

  // -- The human surface ----------------------------------------------------

  /** Mints an approval link without spending it — for cross-change tests. */
  humanMintNonce(): string {
    const issued = issueApprovalNonce(this.workspace, this.taskId);
    this.workspace = issued.workspace;
    return issued.nonce.id;
  }

  /**
   * The browser's approval flow: the nonce exists only there; the application
   * then commits and checks. Returns the final task state.
   */
  humanApprove(): { ok: boolean; error?: string; state?: string; matched?: boolean } {
    const issued = issueApprovalNonce(this.workspace, this.taskId);
    this.workspace = issued.workspace;
    this.consumedNonceId = issued.nonce.id;

    const approved = asAttempt(() => {
      this.workspace = approveChange(this.workspace, this.taskId, issued.nonce.id).workspace;
    });
    if (!approved.ok) return { ok: false, error: approved.error };

    const committed = asAttempt(() => {
      this.workspace = commitStaged(this.workspace, this.taskId).workspace;
    });
    if (!committed.ok) return { ok: false, error: committed.error };

    this.metrics.commitsApplied += 1;
    const verified = asAttempt(() => {
      const result = verifyResult(this.workspace, this.taskId);
      this.workspace = result.workspace;
      return result.verification.matched;
    });
    if (!verified.ok) return { ok: false, error: verified.error };

    const matched = verified.value ?? false;
    if (!matched) this.metrics.mismatchesCaught += 1;
    return { ok: true, state: this.state, matched };
  }

  /**
   * The approval flow stopped between commit and verify — for scenarios that
   * need the world to move while a check is still pending.
   */
  humanApproveThroughCommit(): { ok: boolean; error?: string } {
    const issued = issueApprovalNonce(this.workspace, this.taskId);
    this.workspace = issued.workspace;
    this.consumedNonceId = issued.nonce.id;

    const approved = asAttempt(() => {
      this.workspace = approveChange(this.workspace, this.taskId, issued.nonce.id).workspace;
    });
    if (!approved.ok) return { ok: false, error: approved.error };

    const committed = asAttempt(() => {
      this.workspace = commitStaged(this.workspace, this.taskId).workspace;
    });
    if (!committed.ok) return { ok: false, error: committed.error };

    this.metrics.commitsApplied += 1;
    return { ok: true };
  }

  /** Replays a consumed nonce — the one-time rule must hold. */
  replayNonce(): Attempt {
    if (!this.consumedNonceId) return { ok: false, error: 'no nonce to replay' };
    return this.agentApprove(this.consumedNonceId);
  }

  humanDecide(decision: 'not_yet' | 'keep' | 'abandon'): Attempt {
    return asAttempt(() => {
      if (decision === 'not_yet') {
        this.workspace = declineStaged(this.workspace, this.taskId).workspace;
      } else if (decision === 'keep') {
        this.workspace = acceptResult(this.workspace, this.taskId).workspace;
      } else {
        this.workspace = abandonTask(this.workspace, this.taskId).workspace;
      }
    });
  }

  // -- The world ------------------------------------------------------------

  /** A second task's mutation — another window, or the world simply moving. */
  worldMoves(): void {
    const second = startTask(this.workspace, 'Another window asks for something');
    this.workspace = setConstraints(
      second.workspace,
      second.task.id,
      [{ kind: 'unchanged', field: 'status' }],
      second.workspace.world.revision,
    );
  }

  /**
   * The independent auditor: re-runs the check against the world *right now*,
   * without trusting the task's stored verdict. A task is falsely complete if
   * it claims VERIFIED and the auditor disagrees.
   */
  audit(): { matched: boolean; falseCompletion: boolean } {
    const task = this.task;
    const staged = task.staged!;
    const observed = snapshotOf(
      this.workspace.world.reservations.find((r) => r.id === staged.request.reservationId)!,
    );
    const result = verify(task.constraints, staged.before, observed, {
      revision: this.workspace.world.revision,
      request: staged.request,
    });
    const falseCompletion = task.state === 'VERIFIED' && !result.matched;
    if (falseCompletion) this.metrics.falseCompletions += 1;
    return { matched: result.matched, falseCompletion };
  }
}

/** Throws with a short message when a condition fails — the runner catches it. */
export function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/** Asserts an agent attempt was refused — the safety net of the whole suite. */
export function refused(attempt: Attempt, why: string): void {
  if (attempt.ok) throw new Error(`expected a refusal, but it succeeded: ${why}`);
}

/** Unwraps a successful attempt, throwing (and failing the scenario) if not. */
export function must<T>(attempt: Attempt<T>, why: string): T {
  if (!attempt.ok) throw new Error(`${why}: ${attempt.error}`);
  return attempt.value;
}

/** Asserts a refusal and returns its message, for asserting *why* it refused. */
export function refusal(attempt: Attempt, why: string): string {
  refused(attempt, why);
  return (attempt as { error: string }).error;
}
