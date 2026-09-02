import { describe, expect, it } from 'vitest';
import { failedVerdicts, verify } from '@/lib/proof/verifier';
import type { ReservationSnapshot } from '@/lib/proof/constraints';

/**
 * The canonical demo scenario runs through these tests: the reservation moves
 * to Friday, keeps Room 418, and the price is recomputed by the same formula
 * that produced the original quote.
 */

const BEFORE: ReservationSnapshot = {
  reservationId: 'res_18',
  checkIn: '2026-09-03',
  roomId: '418',
  totalPrice: 294,
  guestName: 'Ada Lovelace',
  ratePlanId: 'flex',
  nights: 2,
  status: 'confirmed',
};

const MOVED_AND_PRICED_294: ReservationSnapshot = { ...BEFORE, checkIn: '2026-09-04' };

const MOVED_AND_PRICED_319: ReservationSnapshot = {
  ...BEFORE,
  checkIn: '2026-09-04',
  totalPrice: 319,
};

const DEMO_CONSTRAINTS = [
  { kind: 'date_equals', date: '2026-09-04' }, // Friday
  { kind: 'room_equals', roomId: '418' },
  { kind: 'price_at_most', amount: 300 },
] as const;

describe('verify — the match case', () => {
  it('reports matched when every constraint holds and nothing else moved', () => {
    const result = verify(DEMO_CONSTRAINTS, BEFORE, MOVED_AND_PRICED_294, { revision: 7 });

    expect(result.matched).toBe(true);
    expect(result.verdicts).toHaveLength(3);
    expect(result.verdicts.every((v) => v.satisfied)).toBe(true);
    expect(result.unexpectedChanges).toEqual([]);
  });

  it('carries the revision it was computed against', () => {
    const result = verify(DEMO_CONSTRAINTS, BEFORE, MOVED_AND_PRICED_294, { revision: 12 });
    expect(result.revision).toBe(12);
  });
});

describe('verify — the mismatch case', () => {
  it('catches the price exceeding the limit, with human phrasing', () => {
    const result = verify(DEMO_CONSTRAINTS, BEFORE, MOVED_AND_PRICED_319, { revision: 8 });

    expect(result.matched).toBe(false);

    const failures = failedVerdicts(result);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.constraint).toEqual({ kind: 'price_at_most', amount: 300 });
    expect(failures[0]?.expected).toBe('Total at most $300');
    expect(failures[0]?.observed).toBe('Total is $319');
  });

  it('still reports the constraints that did hold', () => {
    const result = verify(DEMO_CONSTRAINTS, BEFORE, MOVED_AND_PRICED_319, { revision: 8 });
    const satisfied = result.verdicts.filter((v) => v.satisfied);
    expect(satisfied.map((v) => v.constraint.kind)).toEqual(['date_equals', 'room_equals']);
  });
});

describe('verify — unrequested changes', () => {
  it('flags a field that changed but nobody asked about', () => {
    const observed: ReservationSnapshot = { ...MOVED_AND_PRICED_294, ratePlanId: 'nonrefund' };

    const result = verify(DEMO_CONSTRAINTS, BEFORE, observed, { revision: 9 });

    expect(result.matched).toBe(false);
    expect(result.unexpectedChanges).toEqual([
      { field: 'ratePlanId', before: 'flex', after: 'nonrefund' },
    ]);
  });

  it('does not flag fields a constraint explicitly governs', () => {
    // Moving the date and repricing are both governed by constraints here.
    const result = verify(DEMO_CONSTRAINTS, BEFORE, MOVED_AND_PRICED_294, { revision: 9 });
    expect(result.unexpectedChanges).toEqual([]);
  });

  it('respects an explicit unchanged constraint', () => {
    const observed: ReservationSnapshot = { ...MOVED_AND_PRICED_294, guestName: 'Alan Turing' };
    const constraints = [...DEMO_CONSTRAINTS, { kind: 'unchanged', field: 'guestName' } as const];

    const result = verify(constraints, BEFORE, observed, { revision: 9 });

    const failure = failedVerdicts(result).find((v) => v.constraint.kind === 'unchanged');
    expect(failure?.satisfied).toBe(false);
    expect(failure?.expected).toBe('guestName unchanged');
  });

  it('permits a pinned field to be absent from unexpected changes only when truly unchanged', () => {
    const constraints = [...DEMO_CONSTRAINTS, { kind: 'unchanged', field: 'guestName' } as const];

    const result = verify(constraints, BEFORE, MOVED_AND_PRICED_294, { revision: 9 });

    // guestName is pinned and did not move, so it is neither failed nor unexpected.
    expect(failedVerdicts(result)).toEqual([]);
    expect(result.unexpectedChanges).toEqual([]);
  });
});

describe('verify — status changes are visible', () => {
  it('reports a status flip as an unexpected change unless pinned', () => {
    const observed: ReservationSnapshot = { ...MOVED_AND_PRICED_294, status: 'held' };

    const result = verify(DEMO_CONSTRAINTS, BEFORE, observed, { revision: 10 });

    expect(result.unexpectedChanges).toEqual([
      { field: 'status', before: 'confirmed', after: 'held' },
    ]);
  });
});

describe('verify — fields the approved request itself changes', () => {
  // The staged request is what the human approved on the review card, so a
  // field it changes is asked-for, never "unexpected". Without this, a
  // recovery move to another room could never come out verified.
  it('permits a room change the request names, when no constraint governs the room', () => {
    const observed: ReservationSnapshot = { ...MOVED_AND_PRICED_294, roomId: '401' };
    const constraints = [
      { kind: 'date_equals', date: '2026-09-04' },
      { kind: 'price_at_most', amount: 300 },
    ] as const;

    const result = verify(constraints, BEFORE, observed, {
      revision: 11,
      request: { roomId: '401', checkIn: '2026-09-04', nights: 2 },
    });

    expect(result.unexpectedChanges).toEqual([]);
    expect(result.matched).toBe(true);
  });

  it('does not permit what the request leaves alone — the price can still drift into view', () => {
    const observed: ReservationSnapshot = { ...MOVED_AND_PRICED_319, roomId: '401' };
    const constraints = [{ kind: 'date_equals', date: '2026-09-04' }] as const;

    const result = verify(constraints, BEFORE, observed, {
      revision: 11,
      request: { roomId: '401', checkIn: '2026-09-04', nights: 2 },
    });

    // The room was asked for; the price was not — and it moved.
    expect(result.unexpectedChanges).toEqual([
      { field: 'totalPrice', before: 294, after: 319 },
    ]);
  });

  it('a request that keeps a field unchanged does not permit that field', () => {
    const observed: ReservationSnapshot = { ...MOVED_AND_PRICED_294, nights: 1 };
    const constraints = [{ kind: 'price_at_most', amount: 400 }] as const;

    const result = verify(constraints, BEFORE, observed, {
      revision: 11,
      request: { roomId: '418', checkIn: '2026-09-03', nights: 2 }, // nights unchanged
    });

    expect(result.unexpectedChanges).toContainEqual({
      field: 'nights',
      before: 2,
      after: 1,
    });
  });
});
