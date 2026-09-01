/**
 * The Checker: "Don't trust the plan. Check reality."
 *
 * This is deterministic code. It is never an LLM, and it takes *no* state as
 * input from the caller beyond what to check — the observed snapshot is read
 * fresh by the caller (a route handler re-reading the database), so an agent
 * cannot hand us a favourable picture and have it believed.
 *
 * Two questions are answered, and both matter:
 *
 * 1. Does every stated constraint hold on the observed state?
 * 2. Did anything *else* change that nobody asked for?
 *
 * The second question is what makes "everything you asked for is now true"
 * trustworthy — a change that satisfies the constraints while silently
 * renaming the guest has not finished the job.
 */

import type { Constraint, ConstraintField, ReservationSnapshot } from './constraints';
import { describeConstraint } from './constraints';

export interface ConstraintVerdict {
  constraint: Constraint;
  satisfied: boolean;
  /** Human phrase for what was asked, e.g. "Total at most $300". */
  expected: string;
  /** Human phrase for what was found, e.g. "Total is $319". */
  observed: string;
}

export interface UnexpectedChange {
  field: ConstraintField;
  before: unknown;
  after: unknown;
}

export interface VerificationResult {
  /** True only when every constraint holds AND nothing unrequested changed. */
  matched: boolean;
  verdicts: ConstraintVerdict[];
  unexpectedChanges: UnexpectedChange[];
  /** The revision of the state this result was computed against. */
  revision: number;
  checkedAt: string;
}

function formatSnapshotValue(field: ConstraintField, value: unknown): string {
  if (value === null || value === undefined) return 'none';
  switch (field) {
    case 'totalPrice':
      return `$${value}`;
    case 'nights':
      return `${value} nights`;
    case 'roomId':
      return `Room ${value}`;
    default:
      return String(value);
  }
}

function checkConstraint(
  constraint: Constraint,
  observed: ReservationSnapshot,
  before: ReservationSnapshot,
): ConstraintVerdict {
  switch (constraint.kind) {
    case 'date_equals': {
      const satisfied = observed.checkIn === constraint.date;
      return {
        constraint,
        satisfied,
        expected: describeConstraint(constraint),
        observed: `Check in on ${observed.checkIn}`,
      };
    }
    case 'room_equals': {
      const satisfied = observed.roomId === constraint.roomId;
      return {
        constraint,
        satisfied,
        expected: describeConstraint(constraint),
        observed: `Room ${observed.roomId}`,
      };
    }
    case 'price_at_most': {
      const satisfied = observed.totalPrice <= constraint.amount;
      return {
        constraint,
        satisfied,
        expected: describeConstraint(constraint),
        observed: `Total is $${observed.totalPrice}`,
      };
    }
    case 'unchanged': {
      const beforeValue = before[constraint.field];
      const afterValue = observed[constraint.field];
      return {
        constraint,
        satisfied: beforeValue === afterValue,
        expected: describeConstraint(constraint),
        observed: `${constraint.field} is ${formatSnapshotValue(constraint.field, afterValue)}`,
      };
    }
  }
}

/**
 * The fields a change is *allowed* to touch: those named by the constraints
 * themselves (a `date_equals` implies the date may change; an explicit
 * `unchanged('guestName')` pins the guest). Everything else that differs
 * between `before` and `observed` is an unexpected change.
 */
function permittedFields(constraints: readonly Constraint[]): Set<ConstraintField> {
  const permitted = new Set<ConstraintField>();
  for (const constraint of constraints) {
    switch (constraint.kind) {
      case 'date_equals':
        permitted.add('checkIn');
        break;
      case 'room_equals':
        permitted.add('roomId');
        break;
      case 'price_at_most':
        permitted.add('totalPrice');
        break;
      case 'unchanged':
        // Explicitly pinned, never "permitted" to drift.
        break;
    }
  }
  return permitted;
}

const ALL_FIELDS: ConstraintField[] = [
  'reservationId',
  'checkIn',
  'roomId',
  'totalPrice',
  'guestName',
  'ratePlanId',
  'nights',
  'status',
];

/**
 * Compares the world as it was before the change with the world as re-read
 * after it, against the constraints the human actually set.
 *
 * `matched` is `true` only when every constraint holds and no unrequested
 * field changed. The revision is carried through, not generated here, so a
 * result computed against a stale revision can be rejected downstream.
 */
export function verify(
  constraints: readonly Constraint[],
  before: ReservationSnapshot,
  observed: ReservationSnapshot,
  options: { revision: number; checkedAt?: string },
): VerificationResult {
  const verdicts = constraints.map((c) => checkConstraint(c, observed, before));

  const permitted = permittedFields(constraints);
  const unexpectedChanges: UnexpectedChange[] = ALL_FIELDS.filter((field) => {
    if (permitted.has(field)) return false;
    return before[field] !== observed[field];
  }).map((field) => ({
    field,
    before: before[field],
    after: observed[field],
  }));

  const allSatisfied = verdicts.every((v) => v.satisfied);
  const matched = allSatisfied && unexpectedChanges.length === 0;

  return {
    matched,
    verdicts,
    unexpectedChanges,
    revision: options.revision,
    checkedAt: options.checkedAt ?? new Date().toISOString(),
  };
}

/** The recovery-relevant summary: which constraints failed, and how. */
export function failedVerdicts(result: VerificationResult): ConstraintVerdict[] {
  return result.verdicts.filter((v) => !v.satisfied);
}
