/**
 * The transaction loop: plan → quote → stage → (a human approves) → commit →
 * verify.
 *
 * Everything here runs server-side, behind route handlers. The functions are
 * pure with respect to the workspace: each returns a new workspace, and the
 * caller persists it. Every step is guarded (`lib/proof/policy.ts`), recorded
 * (`lib/proof/audit.ts`), and revision-checked (`lib/proof/revisions.ts`).
 *
 * What is deliberately *not* here: any way for an agent to approve or commit.
 * `approveChange` requires a one-time nonce that only `issueApprovalNonce`
 * creates, and only the realtime channel ever delivers — no tool response
 * carries one, because no tool calls these functions.
 */

import { appendAudit, nowIso } from './audit';
import type { Constraint, ReservationSnapshot } from './constraints';
import { assertCurrentRevision } from './revisions';
import { step } from './policy';
import { canTransition, transition } from './state-machine';
import type { Approval, ApprovalNonce, ProofTask, StagedChange } from './task';
import { verify, type VerificationResult } from './verifier';
import type { Workspace } from '@/lib/store/memory';
import {
  advanceTick,
  commitReservationChange,
  quoteStay,
  type CompetingHold,
  type Quote,
  type Reservation,
  type StayWellWorld,
} from '@/lib/staywell/world';

// ---------------------------------------------------------------------------
// Snapshots: how the world is observed

export function snapshotOf(reservation: Reservation): ReservationSnapshot {
  return {
    reservationId: reservation.id,
    checkIn: reservation.checkIn,
    roomId: reservation.roomId,
    totalPrice: reservation.totalDollars,
    guestName: reservation.guestName,
    ratePlanId: reservation.ratePlanId,
    nights: reservation.nights,
    status: reservation.status,
  };
}

function findReservation(world: StayWellWorld, reservationId: string): Reservation {
  const reservation = world.reservations.find((r) => r.id === reservationId);
  if (!reservation) throw new Error(`no reservation "${reservationId}"`);
  return reservation;
}

function findTask(workspace: Workspace, taskId: string): ProofTask {
  const task = workspace.tasks.find((t) => t.id === taskId);
  if (!task) throw new Error(`no task "${taskId}" in this workspace`);
  return task;
}

function updateTask(
  workspace: Workspace,
  taskId: string,
  update: (task: ProofTask) => ProofTask,
): Workspace {
  return {
    ...workspace,
    tasks: workspace.tasks.map((t) => (t.id === taskId ? update(t) : t)),
  };
}

/** Bumps the workspace revision — every task mutation is a world mutation. */
function bumpRevision(workspace: Workspace): Workspace {
  return { ...workspace, world: { ...workspace.world, revision: workspace.world.revision + 1 } };
}

function withTask(workspace: Workspace, task: ProofTask): Workspace {
  return updateTask(workspace, task.id, () => ({ ...task, updatedAt: nowIso() }));
}

// ---------------------------------------------------------------------------
// Steps the agent may drive

export interface StartTaskResult {
  workspace: Workspace;
  task: ProofTask;
}

export function startTask(workspace: Workspace, goal: string): StartTaskResult {
  const id = `task_${workspace.taskCounter + 1}`;
  const at = nowIso();

  const task: ProofTask = {
    id,
    workspaceId: workspace.id,
    goal,
    state: 'NEW',
    constraints: [],
    staged: null,
    approvals: [],
    verification: null,
    revision: workspace.world.revision,
    createdAt: at,
    updatedAt: at,
  };

  let next: Workspace = {
    ...workspace,
    tasks: [...workspace.tasks, task],
    taskCounter: workspace.taskCounter + 1,
    audit: appendAudit(workspace.audit, { type: 'task_created', taskId: id, goal, at }),
  };
  next = withTask(next, step(task, 'understand'));

  return { workspace: next, task: next.tasks.find((t) => t.id === id)! };
}

/**
 * Sets or refines the typed constraints. Free text never becomes a constraint;
 * the caller (the constraint parser) must already have produced predicates.
 */
export function setConstraints(
  workspace: Workspace,
  taskId: string,
  constraints: Constraint[],
  baseRevision: number,
): Workspace {
  const task = findTask(workspace, taskId);
  assertCurrentRevision(baseRevision, workspace.world.revision);

  // Constraint edits are human-visible, world-visible mutations: they advance
  // the engine, and they invalidate any staged plan (the human wins, §24).
  const { world } = advanceTick(workspace.world);
  let next: Workspace = { ...workspace, world };
  next = bumpRevision(next);

  // UNDERSTANDING moves to PLANNING on the first constraints; later refinement
  // (or a human edit while something is staged) transitions where allowed and
  // otherwise stays put — the edit itself is the consequential part.
  const current = findTask(next, taskId);
  const revised = canTransition(current.state, 'plan') ? step(current, 'plan') : current;

  next = updateTask(next, taskId, (t) => ({
    ...revised,
    constraints,
    // A staged plan built against the old constraints is now out of date.
    staged: null,
    revision: next.world.revision,
    updatedAt: nowIso(),
  }));
  next = {
    ...next,
    audit: appendAudit(next.audit, {
      type: 'constraints_set',
      taskId,
      constraints,
      at: nowIso(),
    }),
  };

  return next;
}

/** Read-only: a quote never advances the engine or changes state. */
export function getQuote(
  workspace: Workspace,
  taskId: string,
  stay: { reservationId: string; roomId: string; checkIn: string; nights: number },
): { quote: Quote; reservation: ReservationSnapshot } {
  findTask(workspace, taskId);
  const reservation = findReservation(workspace.world, stay.reservationId);
  return {
    quote: quoteStay(workspace.world, stay),
    reservation: snapshotOf(reservation),
  };
}

export function stageChange(
  workspace: Workspace,
  taskId: string,
  request: StagedChange['request'],
  options: { rationale?: string; baseRevision: number },
): { workspace: Workspace; task: ProofTask; change: StagedChange } {
  const task = findTask(workspace, taskId);
  assertCurrentRevision(options.baseRevision, workspace.world.revision);

  const before = snapshotOf(findReservation(workspace.world, request.reservationId));
  const quote = quoteStay(workspace.world, request);

  // Staging is a mutation: the engine advances, competing demand may land —
  // which is exactly why the commit re-reads and re-prices rather than
  // trusting this quote.
  const { world } = advanceTick(workspace.world);
  let next: Workspace = { ...workspace, world };
  next = bumpRevision(next);

  const change: StagedChange = {
    id: `change_${taskId}_${next.world.revision}`,
    kind: 'reservation_change',
    before,
    request,
    quote,
    baseRevision: next.world.revision,
    rationale: options.rationale,
    stagedAt: nowIso(),
  };

  const staged = step(findTask(next, taskId), 'stage');
  next = updateTask(next, taskId, (t) => ({
    ...staged,
    staged: change,
    revision: next.world.revision,
    updatedAt: nowIso(),
  }));
  next = {
    ...next,
    audit: appendAudit(next.audit, { type: 'staged', taskId, change, at: nowIso() }),
  };

  return { workspace: next, task: next.tasks.find((t) => t.id === taskId)!, change };
}

// ---------------------------------------------------------------------------
// The step only a human can take

/**
 * Mints the one-time nonce an approval requires. Called by the server when a
 * change reaches READY_FOR_REVIEW; the nonce id travels to the human's browser
 * over the realtime channel. It is never returned by a tool.
 */
export function issueApprovalNonce(workspace: Workspace, taskId: string): {
  workspace: Workspace;
  nonce: ApprovalNonce;
} {
  const task = findTask(workspace, taskId);
  if (!task.staged) throw new Error('nothing is staged to approve');

  // One live nonce per staged change; re-issue only replaces.
  const fresh = workspace.nonces.filter(
    (n) => !(n.taskId === taskId && n.changeId === task.staged!.id && !n.consumedAt),
  );

  const nonce: ApprovalNonce = {
    id: `nonce_${task.staged.id}_${Date.now().toString(36)}`,
    taskId,
    changeId: task.staged.id,
    createdAt: nowIso(),
    consumedAt: null,
  };

  return { workspace: { ...workspace, nonces: [...fresh, nonce] }, nonce };
}

export function approveChange(
  workspace: Workspace,
  taskId: string,
  nonceId: string,
): { workspace: Workspace; task: ProofTask } {
  const task = findTask(workspace, taskId);

  const nonce = workspace.nonces.find((n) => n.id === nonceId);
  if (!nonce || nonce.taskId !== taskId) {
    throw new Error('that approval link is not for this task');
  }
  if (nonce.consumedAt) {
    throw new Error('that approval link has already been used');
  }
  if (!task.staged || task.staged.id !== nonce.changeId) {
    throw new Error('that approval link is for a different change');
  }
  if (!['READY_FOR_REVIEW'].includes(task.state)) {
    throw new Error(`task is ${task.state}; only a staged change can be approved`);
  }

  const approval: Approval = {
    id: `approval_${nonce.id}`,
    changeId: task.staged.id,
    approvedAt: nowIso(),
    nonceId: nonce.id,
    actor: 'human',
  };

  const approved = step(task, 'approve');
  let next: Workspace = updateTask(workspace, taskId, (t) => ({
    ...approved,
    approvals: [...t.approvals, approval],
    updatedAt: nowIso(),
  }));
  next = {
    ...next,
    nonces: next.nonces.map((n) => (n.id === nonceId ? { ...n, consumedAt: nowIso() } : n)),
    audit: appendAudit(next.audit, {
      type: 'approved',
      taskId,
      changeId: task.staged!.id,
      nonceId,
      at: nowIso(),
    }),
  };

  return { workspace: next, task: next.tasks.find((t) => t.id === taskId)! };
}

// ---------------------------------------------------------------------------
// Human decisions after a caught mismatch

/**
 * "Keep this change" — the human accepts the result despite a constraint it
 * broke. Nothing further happens to the world; the task closes honestly as
 * accepted-with-exceptions, and the receipt says exactly which ask went unmet.
 */
export function acceptResult(workspace: Workspace, taskId: string): {
  workspace: Workspace;
  task: ProofTask;
} {
  const task = findTask(workspace, taskId);
  if (!task.verification) throw new Error('nothing has been checked yet to accept');

  const accepted = step(task, 'accept'); // MISMATCH/RECOVERING → ACCEPTED_WITH_EXCEPTIONS
  let next: Workspace = updateTask(workspace, taskId, () => ({
    ...accepted,
    updatedAt: nowIso(),
  }));
  next = {
    ...next,
    audit: appendAudit(next.audit, { type: 'accepted_with_exceptions', taskId, at: nowIso() }),
  };

  return { workspace: next, task: next.tasks.find((t) => t.id === taskId)! };
}

/**
 * Stages one of the recovery options — "find another option" or "undo it" —
 * walking the task back through REPLANNING so the change arrives in review by
 * the same gate as any other: it is applied only after the human approves it.
 */
export function stageRecovery(
  workspace: Workspace,
  taskId: string,
  option: { request: StagedChange['request']; summary: string },
): { workspace: Workspace; task: ProofTask; change: StagedChange } {
  const task = findTask(workspace, taskId);

  let base = workspace;
  if (task.state === 'MISMATCH' || task.state === 'RECOVERING') {
    // replan covers both; from here `stage` is legal again.
    base = updateTask(base, taskId, (t) => ({
      ...step(t, 'replan'),
      updatedAt: nowIso(),
    }));
  }

  const staged = stageChange(base, taskId, option.request, {
    rationale: option.summary,
    baseRevision: base.world.revision,
  });

  let next: Workspace = {
    ...staged.workspace,
    audit: appendAudit(staged.workspace.audit, {
      type: 'recovery_offered',
      taskId,
      options: [option.summary],
      at: nowIso(),
    }),
  };

  return {
    workspace: next,
    task: next.tasks.find((t) => t.id === taskId)!,
    change: staged.change,
  };
}

// ---------------------------------------------------------------------------
// Other human-only steps

/** "Not yet" — the human sends a staged change back to the drawing board. */
export function declineStaged(workspace: Workspace, taskId: string): {
  workspace: Workspace;
  task: ProofTask;
} {
  const task = findTask(workspace, taskId);
  const declined = step(task, 'request_changes'); // READY_FOR_REVIEW → PLANNING
  const next: Workspace = updateTask(workspace, taskId, () => ({
    ...declined,
    staged: null,
    updatedAt: nowIso(),
  }));
  return { workspace: next, task: next.tasks.find((t) => t.id === taskId)! };
}

/** The human walked away. Terminal, and honest about it. */
export function abandonTask(workspace: Workspace, taskId: string): {
  workspace: Workspace;
  task: ProofTask;
} {
  const task = findTask(workspace, taskId);
  const abandoned = step(task, 'abandon');
  const next: Workspace = updateTask(workspace, taskId, () => ({
    ...abandoned,
    updatedAt: nowIso(),
  }));
  return { workspace: next, task: next.tasks.find((t) => t.id === taskId)! };
}

// ---------------------------------------------------------------------------
// Commit and verify: the application's job, then the checker's

export interface CommitOutcomeRecord {
  changeId: string;
  committedAt: string;
  /** Competing demand that landed during the commit, for the inspector. */
  landed: CompetingHold[];
  /** The world as re-read after the commit. */
  observed: ReservationSnapshot;
}

export function commitStaged(workspace: Workspace, taskId: string): {
  workspace: Workspace;
  task: ProofTask;
  outcome: CommitOutcomeRecord;
} {
  const task = findTask(workspace, taskId);

  if (task.state !== 'APPROVED') {
    throw new Error(
      `task is ${task.state}; a change is committed only after a person approves it`,
    );
  }
  const staged = task.staged!;
  // Optimistic concurrency: the plan was built against a revision of the
  // world; if the world moved — human edit in another window, demand landing —
  // the commit is refused and must be restaged.
  assertCurrentRevision(staged.baseRevision, workspace.world.revision);

  const committing = step(task, 'execute');
  let next: Workspace = updateTask(workspace, taskId, () => ({ ...committing, updatedAt: nowIso() }));

  const { world, reservation, landed } = commitReservationChange(workspace.world, {
    reservationId: staged.request.reservationId,
    roomId: staged.request.roomId,
    checkIn: staged.request.checkIn,
    nights: staged.request.nights,
  });

  next = { ...next, world };
  const executed = step(findTask(next, taskId), 'execute_done');
  next = updateTask(next, taskId, (t) => ({
    ...executed,
    revision: world.revision,
    updatedAt: nowIso(),
  }));

  const observed = snapshotOf(reservation);
  const outcome: CommitOutcomeRecord = {
    changeId: staged.id,
    committedAt: nowIso(),
    landed,
    observed,
  };

  next = {
    ...next,
    audit: appendAudit(next.audit, {
      type: 'committed',
      taskId,
      changeId: staged.id,
      outcome,
      at: nowIso(),
    }),
  };

  return { workspace: next, task: next.tasks.find((t) => t.id === taskId)!, outcome };
}

export function verifyResult(workspace: Workspace, taskId: string): {
  workspace: Workspace;
  task: ProofTask;
  verification: VerificationResult;
} {
  const task = findTask(workspace, taskId);

  if (task.state !== 'VERIFYING') {
    throw new Error(
      `task is ${task.state}; reality is checked after a change has been applied`,
    );
  }
  const staged = task.staged!;

  // Fresh read, fresh revision: a verdict computed against anything older is
  // refused outright. This is what makes "EXECUTING → VERIFIED" unreachable.
  assertCurrentRevision(task.revision, workspace.world.revision);

  const observed = snapshotOf(
    findReservation(workspace.world, staged.request.reservationId),
  );
  const result = verify(task.constraints, staged.before, observed, {
    revision: workspace.world.revision,
  });

  const verified = step(task, result.matched ? 'match' : 'mismatch');
  let next: Workspace = updateTask(workspace, taskId, (t) => ({
    ...verified,
    verification: { result, verifiedAt: nowIso() },
    updatedAt: nowIso(),
  }));
  next = {
    ...next,
    audit: appendAudit(next.audit, {
      type: 'verified',
      taskId,
      matched: result.matched,
      result,
      at: nowIso(),
    }),
  };

  return {
    workspace: next,
    task: next.tasks.find((t) => t.id === taskId)!,
    verification: result,
  };
}

// Re-exported so route handlers need only this module for the loop.
export { transition };
