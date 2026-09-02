/**
 * Product voice: the interface speaks human language.
 *
 * No state-machine identifiers, no tool names, no JSON, no raw ids on the main
 * screens — the inspector exists for all of that. Everything here turns what
 * the engine records into the sentences a person would say.
 */

import type { Constraint } from '@/lib/proof/constraints';
import type { TaskState } from '@/lib/proof/state-machine';

/** One-line labels for every state, in the product's voice. */
export const STATE_LABELS: Record<TaskState, string> = {
  NEW: 'Just asked',
  UNDERSTANDING: 'Reading your request',
  PLANNING: 'Working out a plan',
  READY_FOR_REVIEW: 'Waiting for your decision',
  APPROVED: 'Approved — making the change',
  EXECUTING: 'Making the change',
  VERIFYING: 'Checking the result',
  VERIFIED: 'Done, and checked',
  MISMATCH: 'A difference was found',
  RECOVERING: 'Preparing ways forward',
  REPLANNING: 'Reworking the plan',
  ACCEPTED_WITH_EXCEPTIONS: 'Kept, with a difference',
  ABANDONED: 'Set aside',
};

const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'long' });
const SHORT_DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const TIME = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
const FULL = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** "Friday" (with the date for precision: "Friday, Sep 4"). */
export function dayLabel(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return `${WEEKDAY.format(parsed)}, ${SHORT_DATE.format(parsed)}`;
}

export function timeLabel(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? '' : TIME.format(parsed);
}

export function fullTimestamp(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? '' : FULL.format(parsed);
}

const FIELD_LABELS: Record<string, string> = {
  guestName: 'Guest',
  ratePlanId: 'Rate plan',
  nights: 'Length of stay',
  status: 'Status',
  checkIn: 'Check-in date',
  roomId: 'Room',
  totalPrice: 'Price',
  reservationId: 'Reservation',
};

/** The terse phrases for the "You asked for" column and the goal chips. */
export function shortConstraint(constraint: Constraint, before?: { roomId: string } | null): string {
  switch (constraint.kind) {
    case 'date_equals':
      return dayLabel(constraint.date);
    case 'room_equals':
      return before && before.roomId === constraint.roomId ? 'Same room' : `Room ${constraint.roomId}`;
    case 'price_at_most':
      return `≤ $${constraint.amount}`;
    case 'unchanged':
      return `${FIELD_LABELS[constraint.field] ?? constraint.field} unchanged`;
  }
}

/** What changed between the staged "before" and the proposal, in one line each. */
export function describeChange(
  before: { checkIn: string; roomId: string; nights: number; totalPrice: number },
  after: { checkIn: string; roomId: string; nights: number; quote: { totalDollars: number } },
): string[] {
  const changes: string[] = [];
  if (before.checkIn !== after.checkIn) {
    changes.push(`${dayLabel(after.checkIn)} instead of ${dayLabel(before.checkIn)}`);
  }
  if (before.roomId !== after.roomId) {
    changes.push(`Room ${after.roomId} instead of Room ${before.roomId}`);
  }
  if (before.nights !== after.nights) {
    changes.push(
      `${after.nights} night${after.nights === 1 ? '' : 's'} instead of ${before.nights}`,
    );
  }
  const difference = after.quote.totalDollars - before.totalPrice;
  if (difference > 0) changes.push(`+$${difference}`);
  if (difference < 0) changes.push(`−$${Math.abs(difference)}`);
  return changes.length > 0 ? changes : ['Nothing changes'];
}

export interface AuditEventView {
  type: string;
  taskId?: string;
  at: string;
  [key: string]: unknown;
}

/**
 * The timeline, humanized: one line per event, in the product's voice.
 * `state_changed` events are noise here — the events that *caused* them say
 * the same thing better.
 */
export function humanizeEvent(event: AuditEventView): { label: string; at: string } | null {
  switch (event.type) {
    case 'task_created':
      return { label: 'You asked', at: event.at };
    case 'constraints_set':
      return { label: 'Proof understood your request', at: event.at };
    case 'quoted':
      return { label: 'Prices checked', at: event.at };
    case 'staged':
      return { label: 'A change was prepared for you', at: event.at };
    case 'approved':
      return { label: 'You approved', at: event.at };
    case 'committed':
      return { label: 'Change made', at: event.at };
    case 'verified':
      return {
        label:
          typeof event.matched === 'boolean' && event.matched
            ? 'Checked — everything matched'
            : 'Checked — a difference was found',
        at: event.at,
      };
    case 'recovery_offered':
      return { label: 'A way forward was prepared', at: event.at };
    case 'accepted_with_exceptions':
      return { label: 'You kept the result, with a difference', at: event.at };
    case 'state_changed':
      return null;
    default:
      return null;
  }
}
