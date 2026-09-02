/**
 * The human decisions after the loop has done its part:
 *
 * - "Not yet" sends a staged change back to planning,
 * - "Keep this change" closes a mismatch honestly, as accepted-with-exceptions,
 * - "Undo it" and "find another option" stage a recovery that waits for
 *   approval like any other change — and is judged by the same checker,
 * - walking away is terminal.
 *
 * None of these are reachable by an agent; the boundary test covers the import
 * side of that, and these tests cover the behavioural side.
 */

import { describe, expect, it } from 'vitest';
import type { Constraint } from '@/lib/proof/constraints';
import {
  abandonTask,
  acceptResult,
  approveChange,
  commitStaged,
  declineStaged,
  issueApprovalNonce,
  setConstraints,
  startTask,
  stageChange,
  stageRecovery,
  transition,
  verifyResult,
} from '@/lib/proof/transaction';
import { findRecoveryOptions } from '@/lib/proof/recovery';
import { MemoryStore, type Workspace } from '@/lib/store/memory';

const FRIDAY = '2026-09-04';

const DEMO_CONSTRAINTS: Constraint[] = [
  { kind: 'date_equals', date: FRIDAY },
  { kind: 'room_equals', roomId: '418' },
  { kind: 'price_at_most', amount: 300 },
];

const MOVE_REQUEST = {
  reservationId: 'res_18',
  roomId: '418',
  checkIn: FRIDAY,
  nights: 2,
};

function workspaceFor(seed: number): Workspace {
  const store = new MemoryStore();
  return store.createWorkspace('ws_test', seed);
}

/** Seed 4 is the pinned demo: quote $294, committed $319, price caught. */
function mismatchWorkspace(): { ws: Workspace; taskId: string } {
  let ws = workspaceFor(4);
  const start = startTask(ws, 'Move my reservation to Friday, keep the same room, stay under $300');
  ws = start.workspace;
  const taskId = start.task.id;

  ws = setConstraints(ws, taskId, DEMO_CONSTRAINTS, ws.world.revision);
  ws = stageChange(ws, taskId, MOVE_REQUEST, {
    rationale: 'Move to Friday, same room.',
    baseRevision: ws.world.revision,
  }).workspace;

  const issued = issueApprovalNonce(ws, taskId);
  const approved = approveChange(issued.workspace, taskId, issued.nonce.id);
  const committed = commitStaged(approved.workspace, taskId);
  ws = verifyResult(committed.workspace, taskId).workspace;

  const task = ws.tasks.find((t) => t.id === taskId)!;
  expect(task.state).toBe('MISMATCH');
  return { ws, taskId };
}

describe('not yet — the human sends a change back', () => {
  it('returns the task to planning and clears the staged change', () => {
    let { ws, taskId } = mismatchWorkspace(); // any state works; re-drive to review
    // Rebuild a review-ready task from a fresh workspace instead.
    const fresh = workspaceFor(11);
    const start = startTask(fresh, 'goal');
    ws = setConstraints(start.workspace, start.task.id, DEMO_CONSTRAINTS, start.workspace.world.revision);
    taskId = start.task.id;
    ws = stageChange(ws, taskId, MOVE_REQUEST, { baseRevision: ws.world.revision }).workspace;

    const next = declineStaged(ws, taskId);
    const task = next.workspace.tasks.find((t) => t.id === taskId)!;
    expect(task.state).toBe('PLANNING');
    expect(task.staged).toBeNull();
  });

  it('refuses when nothing is staged for review', () => {
    const fresh = workspaceFor(12);
    const start = startTask(fresh, 'goal');
    expect(() => declineStaged(start.workspace, start.task.id)).toThrow();
  });
});

describe('keep this change — accepting a mismatch', () => {
  it('closes the task as accepted-with-exceptions and records it in the audit', () => {
    const { ws, taskId } = mismatchWorkspace();
    const next = acceptResult(ws, taskId);

    const task = next.workspace.tasks.find((t) => t.id === taskId)!;
    expect(task.state).toBe('ACCEPTED_WITH_EXCEPTIONS');
    expect(
      next.workspace.audit.some((e) => e.type === 'accepted_with_exceptions'),
    ).toBe(true);
  });

  it('is terminal — nothing further may happen to the task', () => {
    const { ws, taskId } = mismatchWorkspace();
    const accepted = acceptResult(ws, taskId);
    expect(() => abandonTask(accepted.workspace, taskId)).toThrow(/illegal transition/);
  });

  it('refuses to accept a result that was never checked', () => {
    const fresh = workspaceFor(13);
    const start = startTask(fresh, 'goal');
    expect(() => acceptResult(start.workspace, start.task.id)).toThrow();
  });
});

describe('recovery — undo it', () => {
  it('stages the return to the previous reservation and waits for approval', () => {
    const { ws, taskId } = mismatchWorkspace();
    const option = findRecoveryOptions(ws, taskId).find((o) => o.kind === 'undo')!;

    const staged = stageRecovery(ws, taskId, {
      request: option.request!,
      summary: option.summary,
    });

    const task = staged.workspace.tasks.find((t) => t.id === taskId)!;
    expect(task.state).toBe('READY_FOR_REVIEW');
    expect(task.staged?.request.checkIn).toBe('2026-09-02'); // back to Wednesday
    expect(task.staged?.rationale).toBe(option.summary);
    // The undo is itself a change; it needs approval before anything moves.
    expect(() => commitStaged(staged.workspace, taskId)).toThrow(/approve/);
  });

  it('verifies honestly after the undo — the date ask no longer holds', () => {
    let { ws, taskId } = mismatchWorkspace();
    const option = findRecoveryOptions(ws, taskId).find((o) => o.kind === 'undo')!;
    ws = stageRecovery(ws, taskId, { request: option.request!, summary: option.summary }).workspace;

    const issued = issueApprovalNonce(ws, taskId);
    const approved = approveChange(issued.workspace, taskId, issued.nonce.id);
    const committed = commitStaged(approved.workspace, taskId);
    const verified = verifyResult(committed.workspace, taskId);

    // The checker does not care that a human wanted this: Wednesday is not
    // Friday, so the task lands in MISMATCH again — honestly.
    expect(verified.task.state).toBe('MISMATCH');
    const date = verified.verification.verdicts.find((v) => v.constraint.kind === 'date_equals')!;
    expect(date.satisfied).toBe(false);
  });

  it('also works from RECOVERING, the state the pilot may leave a task in', () => {
    const { ws, taskId } = mismatchWorkspace();
    // Walk MISMATCH → RECOVERING the way the 'recover' event does.
    const recovering: Workspace = {
      ...ws,
      tasks: ws.tasks.map((t) =>
        t.id === taskId ? { ...t, state: transition(t.state, 'recover') } : t,
      ),
    };
    const option = findRecoveryOptions(recovering, taskId).find((o) => o.kind === 'undo')!;
    const staged = stageRecovery(recovering, taskId, {
      request: option.request!,
      summary: option.summary,
    });
    expect(staged.task.state).toBe('READY_FOR_REVIEW');
  });
});

describe('recovery — find another option', () => {
  it('stages an alternate room through the same review gate', () => {
    const { ws, taskId } = mismatchWorkspace();
    const alternate = findRecoveryOptions(ws, taskId).find(
      (o) => o.kind === 'alternate_room',
    )!;

    const staged = stageRecovery(ws, taskId, {
      request: alternate.request!,
      summary: alternate.summary,
    });
    const task = staged.workspace.tasks.find((t) => t.id === taskId)!;
    expect(task.state).toBe('READY_FOR_REVIEW');
    expect(task.staged?.request.roomId).not.toBe('418');
  });

  it('records the recovery in the audit trail', () => {
    const { ws, taskId } = mismatchWorkspace();
    const alternate = findRecoveryOptions(ws, taskId).find(
      (o) => o.kind === 'alternate_room',
    )!;
    const staged = stageRecovery(ws, taskId, {
      request: alternate.request!,
      summary: alternate.summary,
    });
    expect(
      staged.workspace.audit.some((e) => e.type === 'recovery_offered'),
    ).toBe(true);
  });
});

describe('abandon — walking away', () => {
  it('is terminal from planning', () => {
    const fresh = workspaceFor(14);
    const start = startTask(fresh, 'goal');
    const next = abandonTask(start.workspace, start.task.id);
    const task = next.workspace.tasks.find((t) => t.id === start.task.id)!;
    expect(task.state).toBe('ABANDONED');
  });

  it('cannot abandon a verified task', () => {
    const fresh = workspaceFor(15);
    const start = startTask(fresh, 'goal');
    const manuallyVerified = {
      ...start.workspace,
      tasks: start.workspace.tasks.map((t) =>
        t.id === start.task.id ? { ...t, state: 'VERIFIED' as const } : t,
      ),
    };
    expect(() => abandonTask(manuallyVerified, start.task.id)).toThrow(/illegal transition/);
  });
});
