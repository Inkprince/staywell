/**
 * Recovery options, judged the way the mismatch screen presents them.
 */

import { describe, expect, it } from 'vitest';
import type { Constraint } from '@/lib/proof/constraints';
import { findRecoveryOptions, requiresHumanChoice } from '@/lib/proof/recovery';
import {
  approveChange,
  commitStaged,
  issueApprovalNonce,
  setConstraints,
  startTask,
  stageChange,
  verifyResult,
} from '@/lib/proof/transaction';
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

function mismatchedWorkspace(): { ws: Workspace; taskId: string } {
  let ws = new MemoryStore().createWorkspace('ws_recovery');

  // Find a seed where the demo mismatches on price.
  let seed = 1;
  for (; seed <= 500; seed++) {
    const candidate = new MemoryStore().createWorkspace(`ws_scan_${seed}`, seed);
    const flow = driveToVerification(candidate);
    if (flow.verification?.matched === false) break;
  }

  const target = new MemoryStore().createWorkspace('ws_recovery', seed);
  const flow = driveToVerification(target);
  expect(flow.verification?.matched).toBe(false);

  return { ws: flow.ws, taskId: flow.taskId };
}

function driveToVerification(ws: Workspace): {
  ws: Workspace;
  taskId: string;
  verification: { matched: boolean } | null;
} {
  const start = startTask(ws, 'Move my reservation to Friday, keep the same room, stay under $300');
  let current = start.workspace;
  const taskId = start.task.id;

  current = setConstraints(current, taskId, DEMO_CONSTRAINTS, current.world.revision);
  current = stageChange(current, taskId, MOVE_REQUEST, {
    baseRevision: current.world.revision,
  }).workspace;
  const issued = issueApprovalNonce(current, taskId);
  current = issued.workspace;
  current = approveChange(current, taskId, issued.nonce.id).workspace;
  current = commitStaged(current, taskId).workspace;
  const verified = verifyResult(current, taskId);

  return {
    ws: verified.workspace,
    taskId,
    verification: verified.verification
      ? { matched: verified.verification.matched }
      : null,
  };
}

describe('findRecoveryOptions', () => {
  it('offers keep, undo, and alternates after a mismatch', () => {
    const { ws, taskId } = mismatchedWorkspace();

    const options = findRecoveryOptions(ws, taskId);
    const kinds = options.map((o) => o.kind);

    expect(kinds).toContain('keep_change');
    expect(kinds).toContain('undo');
    expect(kinds.filter((k) => k === 'alternate_room').length).toBeGreaterThan(0);
  });

  it('annotates every option with the constraints it satisfies and breaks', () => {
    const { ws, taskId } = mismatchedWorkspace();

    for (const option of findRecoveryOptions(ws, taskId)) {
      for (const constraint of DEMO_CONSTRAINTS) {
        const inSatisfies = option.satisfies.some((c) => JSON.stringify(c) === JSON.stringify(constraint));
        const inViolates = option.violates.some((c) => JSON.stringify(c) === JSON.stringify(constraint));
        // Every stated constraint appears in exactly one column.
        expect(inSatisfies === inViolates).toBe(false);
      }
    }
  });

  it('sorts fully-satisfying alternates first', () => {
    const { ws, taskId } = mismatchedWorkspace();
    const options = findRecoveryOptions(ws, taskId);

    const violates = options.map((o) => o.violates.length);
    expect([...violates].sort((a, b) => a - b)).toEqual(violates);
  });

  it('shows the violated constraint honestly on the keep option', () => {
    const { ws, taskId } = mismatchedWorkspace();
    const keep = findRecoveryOptions(ws, taskId).find((o) => o.kind === 'keep_change')!;

    // The price constraint is what broke; keep says so.
    expect(keep.violates).toEqual([{ kind: 'price_at_most', amount: 300 }]);
    expect(keep.satisfies.map((c) => c.kind)).toEqual(['date_equals', 'room_equals']);
    expect(requiresHumanChoice(keep)).toBe(true);
  });

  it('marks undo with what the original reservation would break', () => {
    const { ws, taskId } = mismatchedWorkspace();
    const undo = findRecoveryOptions(ws, taskId).find((o) => o.kind === 'undo')!;

    // The original was Wednesday: the Friday ask would be broken by going back.
    expect(undo.violates.map((c) => c.kind)).toContain('date_equals');
  });

  it('refuses to invent options before a mismatch exists', () => {
    const ws = new MemoryStore().createWorkspace('ws_none');
    const start = startTask(ws, 'Move my reservation');

    expect(() => findRecoveryOptions(start.workspace, start.task.id)).toThrow(
      /after a caught mismatch/,
    );
  });
});
