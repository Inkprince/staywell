/**
 * Recovery.
 *
 * When verification fails, the human chooses what happens next. This module
 * computes the options and — crucially — annotates every one with which stated
 * constraints it satisfies and which it violates. An option that breaks a
 * constraint the human set can never be auto-selected: it is presented as an
 * explicit choice, with the trade visible.
 *
 * Three shapes of option, matching the mismatch screen:
 *
 * - **find another option** — other rooms, quoted fresh, constraint by constraint
 * - **keep this change** — accept the result and the constraint it broke
 * - **undo it** — return to the reservation as it was
 */

import type { Constraint } from './constraints';
import { failedVerdicts } from './verifier';
import type { ProofTask } from './task';
import type { Workspace } from '@/lib/store/memory';
import { assertAvailable, quoteStay, ROOMS, stayDates, type Quote } from '@/lib/staywell/world';
import { snapshotOf } from './transaction';

export type RecoveryOption = {
  id: string;
  kind: 'alternate_room' | 'keep_change' | 'undo';
  /** One line, in product voice, for the recovery card. */
  summary: string;
  /** Present for room options: the fresh quote being offered. */
  quote?: Quote;
  /** The staged request an alternate room would commit. */
  request?: { reservationId: string; roomId: string; checkIn: string; nights: number };
  satisfies: readonly Constraint[];
  violates: readonly Constraint[];
};

function evaluate(
  constraints: readonly Constraint[],
  observed: { roomId: string; checkIn: string; totalPrice: number },
): { satisfies: Constraint[]; violates: Constraint[] } {
  const satisfies: Constraint[] = [];
  const violates: Constraint[] = [];

  for (const constraint of constraints) {
    switch (constraint.kind) {
      case 'date_equals':
        (observed.checkIn === constraint.date ? satisfies : violates).push(constraint);
        break;
      case 'room_equals':
        (observed.roomId === constraint.roomId ? satisfies : violates).push(constraint);
        break;
      case 'price_at_most':
        (observed.totalPrice <= constraint.amount ? satisfies : violates).push(constraint);
        break;
      case 'unchanged':
        // Recovery options keep every `unchanged` field by construction.
        satisfies.push(constraint);
        break;
    }
  }

  return { satisfies, violates };
}

/**
 * The options for a task that just mismatched. Nothing here is selected; the
 * output is a menu with the trade-offs spelled out, and the violating options
 * are exactly the ones that require a human.
 */
export function findRecoveryOptions(workspace: Workspace, taskId: string): RecoveryOption[] {
  const task = workspace.tasks.find((t) => t.id === taskId);
  if (!task) throw new Error(`no task "${taskId}"`);
  if (task.state !== 'MISMATCH' && task.state !== 'RECOVERING') {
    throw new Error(`task is ${task.state}; recovery options exist after a caught mismatch`);
  }
  const verification = task.verification?.result;
  if (!verification || !task.staged) throw new Error('no mismatch to recover from');

  const staged = task.staged;
  const observed = snapshotOf(
    workspace.world.reservations.find((r) => r.id === staged.request.reservationId)!,
  );
  const failed = failedVerdicts(verification).map((v) => v.constraint);

  const options: RecoveryOption[] = [];

  // Keep this change: the result stands, the broken constraint is the cost.
  options.push({
    id: `keep_${staged.id}`,
    kind: 'keep_change',
    summary: `Keep this change and accept ${observed.totalPrice > staged.quote.totalDollars ? 'the new price' : 'the result as it stands'}.`,
    satisfies: task.constraints.filter((c) => !failed.includes(c)),
    violates: failed,
  });

  // Undo it: back to the reservation as it was, judged honestly against the
  // same constraints — the original may itself not satisfy them.
  const before = staged.before;
  const undoVerdict = evaluate(task.constraints, {
    roomId: before.roomId,
    checkIn: before.checkIn,
    totalPrice: before.totalPrice,
  });
  options.push({
    id: `undo_${staged.id}`,
    kind: 'undo',
    summary: 'Return to your previous reservation exactly as it was.',
    request: {
      reservationId: staged.request.reservationId,
      roomId: before.roomId,
      checkIn: before.checkIn,
      nights: before.nights,
    },
    satisfies: undoVerdict.satisfies,
    violates: undoVerdict.violates,
  });

  // Find another option: every other available room, quoted fresh, each
  // annotated constraint by constraint. Rooms that satisfy *more* of the
  // request sort first; ties break on price.
  const stayDatesForObserved = stayDates(staged.request.checkIn, staged.request.nights);
  const alternates = ROOMS.filter((room) => room.id !== staged.request.roomId)
    .filter((room) => {
      try {
        assertAvailable(
          { ...workspace.world, reservations: workspace.world.reservations.filter((r) => r.id !== staged.request.reservationId) },
          room.id,
          stayDatesForObserved,
        );
        return true;
      } catch {
        return false;
      }
    })
    .map((room) => {
      const quote = quoteStay(workspace.world, {
        roomId: room.id,
        checkIn: staged.request.checkIn,
        nights: staged.request.nights,
      });
      const verdict = evaluate(task.constraints, {
        roomId: room.id,
        checkIn: staged.request.checkIn,
        totalPrice: quote.totalDollars,
      });
      return { room, quote, verdict };
    });

  for (const { room, quote, verdict } of alternates) {
    options.push({
      id: `alt_${staged.id}_${room.id}`,
      kind: 'alternate_room',
      summary: `Move to Room ${room.id} instead — ${quote.totalDollars > staged.quote.totalDollars ? 'quoted' : 'total'} $${quote.totalDollars}, ${quote.tierLabel} pricing.`,
      quote,
      request: {
        reservationId: staged.request.reservationId,
        roomId: room.id,
        checkIn: staged.request.checkIn,
        nights: staged.request.nights,
      },
      satisfies: verdict.satisfies,
      violates: verdict.violates,
    });
  }

  // Fully-satisfying alternates first, then price ascending.
  return options.sort((a, b) => {
    const aViolates = a.violates.length;
    const bViolates = b.violates.length;
    if (aViolates !== bViolates) return aViolates - bViolates;
    return (a.quote?.totalDollars ?? Infinity) - (b.quote?.totalDollars ?? Infinity);
  });
}

/**
 * An option that violates a stated constraint can never be auto-selected —
 * it must go to the human as an explicit choice (brief Scene 6). The tools
 * layer consults this before offering to act.
 */
export function requiresHumanChoice(option: RecoveryOption): boolean {
  return option.violates.length > 0;
}
