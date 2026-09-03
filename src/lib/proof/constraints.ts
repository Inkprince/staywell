/**
 * Typed constraints.
 *
 * A constraint is never free text. It is a predicate the *server* can evaluate
 * deterministically against observed state — which is what makes verification
 * honest: an agent cannot argue with a `price_at_most` check; it either holds
 * or it does not.
 */

/** The slice of the world a constraint can talk about. StayWell-flavoured. */
export interface ReservationSnapshot {
  reservationId: string;
  /** Check-in date, `YYYY-MM-DD`. */
  checkIn: string;
  roomId: string;
  /** Total price for the stay, in whole currency units. */
  totalPrice: number;
  guestName: string;
  /** Occupancy is shown to the guest and enforced by the hotel engine. */
  guestCount?: number;
  ratePlanId: string;
  nights: number;
  status: 'held' | 'confirmed' | 'cancelled';
}

/** Guest count is operational context, not a field a Proof task may alter. */
export type ConstraintField = Exclude<keyof ReservationSnapshot, 'guestCount'>;

export type Constraint =
  | { kind: 'date_equals'; date: string }
  | { kind: 'room_equals'; roomId: string }
  | { kind: 'price_at_most'; amount: number }
  | { kind: 'unchanged'; field: ConstraintField };

export const CONSTRAINT_KINDS = [
  'date_equals',
  'room_equals',
  'price_at_most',
  'unchanged',
] as const;

export type ConstraintKind = (typeof CONSTRAINT_KINDS)[number];

/** A one-line, human phrase for each constraint, for the mismatch screen. */
export function describeConstraint(constraint: Constraint): string {
  switch (constraint.kind) {
    case 'date_equals':
      return `Check in on ${constraint.date}`;
    case 'room_equals':
      return `Room ${constraint.roomId}`;
    case 'price_at_most':
      return `Total at most $${constraint.amount}`;
    case 'unchanged':
      return `${constraint.field} unchanged`;
  }
}
