/**
 * The task record's data model, in the shape the store holds.
 *
 * A task is the human's ask plus everything that has happened around it: the
 * constraints (typed, never free text), the staged change awaiting review, the
 * approval that released it, and the verification that judged the result.
 */

import type { Constraint, ReservationSnapshot } from './constraints';
import type { Quote } from '@/lib/staywell/world';
import type { TaskState } from './state-machine';

export interface StagedChange {
  id: string;
  kind: 'reservation_change';
  /** The world as it was when the change was staged — the "expected". */
  before: ReservationSnapshot;
  request: {
    reservationId: string;
    roomId: string;
    checkIn: string;
    nights: number;
  };
  /** The quote the human was shown at staging time. */
  quote: Quote;
  /** The revision this was planned against; a stale base is refused at commit. */
  baseRevision: number;
  rationale?: string;
  stagedAt: string;
}

/**
 * Approval is a first-class record, not a boolean. It records *who* released
 * the change and *which* one-time nonce was consumed — the nonce is only ever
 * delivered over the realtime channel to the human's browser, never through a
 * tool response, which is why no agent can produce one.
 */
export interface Approval {
  id: string;
  changeId: string;
  approvedAt: string;
  nonceId: string;
  /** Deliberately not an agent id. See WITHHELD_TOOLS. */
  actor: 'human';
}

export interface ApprovalNonce {
  id: string;
  taskId: string;
  changeId: string;
  createdAt: string;
  consumedAt: string | null;
}

export interface VerificationRecord {
  /** The `VerificationResult` computed by the deterministic checker. */
  result: import('./verifier').VerificationResult;
  verifiedAt: string;
}

export interface ProofTask {
  id: string;
  workspaceId: string;
  /** The human's words, verbatim. */
  goal: string;
  state: TaskState;
  constraints: Constraint[];
  staged: StagedChange | null;
  approvals: Approval[];
  verification: VerificationRecord | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

/** Reservation shape as tasks and tools see it — the observable world. */
export type { ReservationSnapshot };
