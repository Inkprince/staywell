/**
 * The transaction loop end-to-end, against the in-memory store and the real
 * staywell simulator. These tests are the product's promise, executed:
 *
 * - the happy path reaches VERIFIED with a receipt-worthy verification,
 * - the seeded-contention path lands in MISMATCH with the price caught,
 * - and every adversarial move an agent might make is refused.
 */

import { describe, expect, it } from 'vitest';
import type { Constraint } from '@/lib/proof/constraints';
import { StaleRevisionError } from '@/lib/proof/revisions';
import {
  approveChange,
  commitStaged,
  getQuote,
  issueApprovalNonce,
  setConstraints,
  startTask,
  stageChange,
  verifyResult,
} from '@/lib/proof/transaction';
import { MemoryStore, type Workspace } from '@/lib/store/memory';
import { quoteStay } from '@/lib/staywell/world';

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

type DemoFlow = 'clean' | 'mismatch';

/** The canonical demo flow, driven the way the tools layer will drive it. */
function runDemo(seed: number): {
  outcome: DemoFlow;
  workspace: Workspace;
  finalState: string;
  verification: { matched: boolean; priceObserved: string } | null;
} {
  let ws = workspaceFor(seed);

  const start = startTask(ws, 'Move my reservation to Friday, keep the same room, stay under $300');
  ws = start.workspace;
  const taskId = start.task.id;

  ws = setConstraints(ws, taskId, DEMO_CONSTRAINTS, ws.world.revision);

  const { quote } = getQuote(ws, taskId, MOVE_REQUEST);
  const staged = stageChange(ws, taskId, MOVE_REQUEST, {
    rationale: 'Move to Friday, same room.',
    baseRevision: ws.world.revision,
  });
  ws = staged.workspace;

  const issued = issueApprovalNonce(ws, taskId);
  ws = issued.workspace;
  const approved = approveChange(ws, taskId, issued.nonce.id);
  ws = approved.workspace;

  const committed = commitStaged(ws, taskId);
  ws = committed.workspace;

  const verified = verifyResult(ws, taskId);
  ws = verified.workspace;

  const outcome: DemoFlow = verified.verification.matched ? 'clean' : 'mismatch';

  return {
    outcome,
    workspace: ws,
    finalState: verified.task.state,
    verification: {
      matched: verified.verification.matched,
      priceObserved:
        verified.verification.verdicts.find((v) => v.constraint.kind === 'price_at_most')
          ?.observed ?? 'unknown',
    },
  };
}

/** Finds a seed whose schedule collides (or never collides) with the demo. */
function findSeed(outcome: DemoFlow): number {
  for (let seed = 1; seed <= 500; seed++) {
    if (runDemo(seed).outcome === outcome) return seed;
  }
  throw new Error(`no seed in 1..500 gives a ${outcome} demo`);
}

describe('the happy path', () => {
  it('reaches VERIFIED, and says "Total is $294"', () => {
    const seed = findSeed('clean');
    const flow = runDemo(seed);

    expect(flow.outcome).toBe('clean');
    expect(flow.finalState).toBe('VERIFIED');
    expect(flow.verification).toEqual({
      matched: true,
      priceObserved: 'Total is $294',
    });
  });

  it('walks the exact state sequence', () => {
    const seed = findSeed('clean');
    let ws = workspaceFor(seed);

    const start = startTask(ws, 'Move my reservation to Friday');
    ws = start.workspace;
    expect(start.task.state).toBe('UNDERSTANDING');

    ws = setConstraints(ws, start.task.id, DEMO_CONSTRAINTS, ws.world.revision);
    let task = ws.tasks.find((t) => t.id === start.task.id)!;
    expect(task.state).toBe('PLANNING');

    const staged = stageChange(ws, start.task.id, MOVE_REQUEST, {
      baseRevision: ws.world.revision,
    });
    ws = staged.workspace;
    task = ws.tasks.find((t) => t.id === start.task.id)!;
    expect(task.state).toBe('READY_FOR_REVIEW');

    const issued = issueApprovalNonce(ws, start.task.id);
    ws = issued.workspace;
    ws = approveChange(ws, start.task.id, issued.nonce.id).workspace;
    task = ws.tasks.find((t) => t.id === start.task.id)!;
    expect(task.state).toBe('APPROVED');

    ws = commitStaged(ws, start.task.id).workspace;
    task = ws.tasks.find((t) => t.id === start.task.id)!;
    expect(task.state).toBe('VERIFYING');

    const verified = verifyResult(ws, start.task.id);
    expect(verified.task.state).toBe('VERIFIED');
  });
});

describe('the seeded mismatch', () => {
  it('lands in MISMATCH with the price caught, not asserted', () => {
    const seed = findSeed('mismatch');
    const flow = runDemo(seed);

    expect(flow.outcome).toBe('mismatch');
    expect(flow.finalState).toBe('MISMATCH');
    expect(flow.verification).toEqual({
      matched: false,
      priceObserved: 'Total is $319',
    });
  });

  it('records an approval from a human with a consumed nonce', () => {
    const seed = findSeed('mismatch');
    const ws = runDemo(seed).workspace;
    const task = ws.tasks[0]!;

    expect(task.approvals).toHaveLength(1);
    expect(task.approvals[0]?.actor).toBe('human');

    const nonce = ws.nonces.find((n) => n.id === task.approvals[0]?.nonceId);
    expect(nonce?.consumedAt).toBeTruthy();
  });

  it('leaves an audit trail a receipt can be built from', () => {
    const seed = findSeed('mismatch');
    const ws = runDemo(seed).workspace;

    const types = ws.audit.map((e) => e.type);
    expect(types).toEqual([
      'task_created',
      'constraints_set',
      'staged',
      'approved',
      'committed',
      'verified',
    ]);
  });
});

describe('adversarial moves are refused', () => {
  it('refuses commit before approval, with the reason in product voice', () => {
    let ws = workspaceFor(42);
    const start = startTask(ws, 'Move my reservation to Friday');
    ws = start.workspace;
    ws = setConstraints(ws, start.task.id, DEMO_CONSTRAINTS, ws.world.revision);
    ws = stageChange(ws, start.task.id, MOVE_REQUEST, {
      baseRevision: ws.world.revision,
    }).workspace;

    expect(() => commitStaged(ws, start.task.id)).toThrow(/only after a person approves/);
  });

  it('refuses verify before anything has been committed', () => {
    let ws = workspaceFor(42);
    const start = startTask(ws, 'Move my reservation to Friday');
    ws = start.workspace;

    expect(() => verifyResult(ws, start.task.id)).toThrow(/after a change has been applied/);
  });

  it('refuses a reused approval nonce', () => {
    let ws = workspaceFor(42);
    const start = startTask(ws, 'Move my reservation to Friday');
    ws = start.workspace;
    ws = setConstraints(ws, start.task.id, DEMO_CONSTRAINTS, ws.world.revision);
    ws = stageChange(ws, start.task.id, MOVE_REQUEST, {
      baseRevision: ws.world.revision,
    }).workspace;

    const issued = issueApprovalNonce(ws, start.task.id);
    ws = issued.workspace;
    ws = approveChange(ws, start.task.id, issued.nonce.id).workspace;

    expect(() => approveChange(ws, start.task.id, issued.nonce.id)).toThrow(/already been used/);
  });

  it('refuses a nonce minted for a different change', () => {
    let ws = workspaceFor(42);
    const a = startTask(ws, 'Move my reservation');
    const b = startTask(a.workspace, 'Something else entirely');
    ws = b.workspace;
    ws = setConstraints(ws, a.task.id, DEMO_CONSTRAINTS, ws.world.revision);
    ws = stageChange(ws, a.task.id, MOVE_REQUEST, {
      baseRevision: ws.world.revision,
    }).workspace;

    // Task b has nothing staged, so no nonce can be minted for it. The point
    // is the refusal: a nonce from elsewhere must not approve task a's change.
    const { nonce } = issueApprovalNonce(ws, a.task.id);
    ws = { ...ws, nonces: [{ ...nonce, taskId: b.task.id }] };

    expect(() => approveChange(ws, a.task.id, nonce.id)).toThrow(
      /different change|not for this task/,
    );
  });

  it('refuses commit when the world moved on (two windows, one workspace)', () => {
    let ws = workspaceFor(42);
    const start = startTask(ws, 'Move my reservation to Friday');
    ws = start.workspace;
    ws = setConstraints(ws, start.task.id, DEMO_CONSTRAINTS, ws.world.revision);
    const staged = stageChange(ws, start.task.id, MOVE_REQUEST, {
      baseRevision: ws.world.revision,
    });
    ws = staged.workspace;

    // The human edits constraints in another window while the plan is staged.
    ws = setConstraints(ws, start.task.id, [...DEMO_CONSTRAINTS, { kind: 'unchanged', field: 'nights' } as Constraint], ws.world.revision);

    // The staged plan was invalidated by the edit...
    const task = ws.tasks.find((t) => t.id === start.task.id)!;
    expect(task.staged).toBeNull();

    // ...and even a plan staged against the old revision is refused at commit.
    expect(() =>
      stageChange(ws, start.task.id, MOVE_REQUEST, { baseRevision: 1 }),
    ).toThrow(StaleRevisionError);
  });
});

describe('quotes', () => {
  it('are read-only: the engine does not advance', () => {
    let ws = workspaceFor(42);
    const start = startTask(ws, 'Move my reservation to Friday');
    ws = start.workspace;
    ws = setConstraints(ws, start.task.id, DEMO_CONSTRAINTS, ws.world.revision);

    const tickBefore = ws.world.tick;
    const revisionBefore = ws.world.revision;

    getQuote(ws, start.task.id, MOVE_REQUEST);
    getQuote(ws, start.task.id, MOVE_REQUEST);

    expect(ws.world.tick).toBe(tickBefore);
    expect(ws.world.revision).toBe(revisionBefore);
    expect(quoteStay(ws.world, MOVE_REQUEST).totalDollars).toBe(294);
  });
});
