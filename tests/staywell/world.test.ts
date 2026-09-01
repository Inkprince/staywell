import { describe, expect, it } from 'vitest';
import {
  advanceTick,
  CALENDAR,
  commitReservationChange,
  createWorld,
  generateSchedule,
  occupancyFor,
  PRICING_TIERS,
  priceStay,
  quoteStay,
  stayDates,
  tierFor,
  TOTAL_ROOMS,
  UnavailableError,
  type Reservation,
} from '@/lib/staywell/world';

const FRIDAY = '2026-09-04';

describe('priceStay — the one formula', () => {
  it('prices Room 418, two nights, busy tier at exactly $294', () => {
    // 12250¢ × 2 nights × 12000bp = 29400¢, already whole.
    expect(priceStay(12250, 2, 12000)).toBe(294);
  });

  it('prices Room 418, two nights, high-demand tier at exactly $319', () => {
    // 12250¢ × 2 × 13000bp = 31850¢ → $318.50 → halves round up.
    expect(priceStay(12250, 2, 13000)).toBe(319);
  });

  it('is exact integer arithmetic — no float drift', () => {
    // The classic failure: 245 × 1.3 === 318.49999999999994 in float.
    expect(priceStay(12250, 2, 13000)).not.toBe(318);
  });
});

describe('tierFor', () => {
  it('maps occupancy onto the yield ladder', () => {
    expect(tierFor(0.4).label).toBe('quiet');
    expect(tierFor(0.6).label).toBe('steady');
    expect(tierFor(0.72).label).toBe('busy');
    expect(tierFor(0.88).label).toBe('high demand');
    expect(tierFor(1.0).label).toBe('high demand');
  });

  it('covers every occupancy with a tier', () => {
    for (const tier of PRICING_TIERS) {
      expect(tier.multiplierBp).toBeGreaterThan(0);
    }
  });
});

describe('createWorld', () => {
  it('is deterministic for a given seed', () => {
    expect(createWorld(42)).toEqual(createWorld(42));
  });

  it('differs across seeds', () => {
    expect(generateSchedule(1)).not.toEqual(generateSchedule(2));
  });

  it('seeds the guest reservation at $294, priced by the same formula', () => {
    const world = createWorld(42);
    const reservation = world.reservations[0]!;

    expect(reservation).toMatchObject({
      id: 'res_18',
      roomId: '418',
      checkIn: '2026-09-02',
      nights: 2,
      totalDollars: 294,
      pricedAtOccupancy: 0.72,
    });
  });

  it('starts every date at 72% occupancy', () => {
    const world = createWorld(42);
    for (const date of CALENDAR) {
      expect(world.occupied[date]).toBe(18);
    }
    expect(occupancyFor(world, ['2026-09-04', '2026-09-05'])).toBe(0.72);
  });
});

describe('quoteStay', () => {
  it('quotes Friday in Room 418 at $294, without advancing the engine', () => {
    const world = createWorld(42);
    const quote = quoteStay(world, { roomId: '418', checkIn: FRIDAY, nights: 2 });

    expect(quote).toMatchObject({
      roomId: '418',
      totalDollars: 294,
      occupancy: 0.72,
      tierLabel: 'busy',
      tick: 0,
    });
    expect(world.tick).toBe(0);
  });
});

describe('advanceTick', () => {
  it('lands only the holds that are due, and only once', () => {
    const world = createWorld(7);
    const dueAtTick1 = world.schedule.filter((h) => h.tick <= 1);

    const first = advanceTick(world);
    expect(first.landed).toEqual(dueAtTick1);

    const second = advanceTick(first.world);
    // Ticks already applied must not land again.
    const reapplied = second.landed.filter((h) =>
      first.landed.some((l) => l.id === h.id),
    );
    expect(reapplied).toEqual([]);
  });

  it('never fills the last room', () => {
    let world = createWorld(7);
    for (let i = 0; i < 12; i++) {
      world = advanceTick(world).world;
    }
    for (const date of CALENDAR) {
      expect(world.occupied[date]).toBeLessThanOrEqual(TOTAL_ROOMS - 1);
    }
  });
});

describe('commitReservationChange', () => {
  it('moves the reservation and keeps the quote price when no demand lands', () => {
    // Find a seed whose schedule holds nothing on Fri/Sat by tick 2.
    const seed = findSeedWhere('clean');
    const world = createWorld(seed);
    const quote = quoteStay(world, { roomId: '418', checkIn: FRIDAY, nights: 2 });

    // The flow: quote (read), stage (tick 1), commit (tick 2).
    const staged = advanceTick(world).world;
    const outcome = commitReservationChange(staged, {
      reservationId: 'res_18',
      roomId: '418',
      checkIn: FRIDAY,
      nights: 2,
    });

    expect(outcome.reservation).toMatchObject({
      roomId: '418',
      checkIn: FRIDAY,
      totalDollars: quote.totalDollars,
      status: 'confirmed',
    });
    // Engine starts at tick 0/revision 1; staging advanced one tick, commit one
    // more and bumped the revision once more.
    expect(outcome.world.tick).toBe(2);
    expect(outcome.world.revision).toBe(2);
  });

  it('reprices to $319 when competing demand lands between quote and commit', () => {
    const seed = findSeedWhere('mismatch');
    const world = createWorld(seed);
    const quote = quoteStay(world, { roomId: '418', checkIn: FRIDAY, nights: 2 });

    expect(quote.totalDollars).toBe(294);

    const staged = advanceTick(world).world;
    const outcome = commitReservationChange(staged, {
      reservationId: 'res_18',
      roomId: '418',
      checkIn: FRIDAY,
      nights: 2,
    });

    // The mismatch is emergent: same formula, higher occupancy.
    expect(outcome.reservation.totalDollars).toBe(319);
    expect(outcome.reservation.pricedAtOccupancy).toBeGreaterThan(quote.occupancy);
    // Demand that landed during staging is visible; the commit itself may
    // land none, so accept demand from the whole two-tick window.
    const stagedLanded = staged.appliedHoldIds.length - world.appliedHoldIds.length;
    expect(outcome.landed.length + stagedLanded).toBeGreaterThan(0);
  });

  it('refuses a room already booked for those dates', () => {
    // Another guest holds Room 419 over Friday — the commit (for a different
    // reservation, the demo guest's res_18) must be refused.
    const world = createWorld(42);
    const otherGuest: Reservation = {
      ...world.reservations[0]!,
      id: 'res_99',
      guestName: 'Grace Hopper',
      roomId: '419',
      checkIn: FRIDAY,
    };
    const withBooking = { ...world, reservations: [...world.reservations, otherGuest] };

    expect(() =>
      commitReservationChange(withBooking, {
        reservationId: 'res_18',
        roomId: '419',
        checkIn: FRIDAY,
        nights: 2,
      }),
    ).toThrow(UnavailableError);
  });

  it('refuses unknown reservations, dates, and rooms', () => {
    const world = createWorld(42);

    expect(() =>
      commitReservationChange(world, {
        reservationId: 'res_999',
        roomId: '418',
        checkIn: FRIDAY,
        nights: 2,
      }),
    ).toThrow(/unknown reservation/);

    expect(() => quoteStay(world, { roomId: '418', checkIn: '2027-01-01', nights: 2 })).toThrow(
      /bookable window/,
    );

    expect(() => quoteStay(world, { roomId: '9999', checkIn: FRIDAY, nights: 2 })).toThrow(
      /unknown room/,
    );
  });
});

// ---------------------------------------------------------------------------
// Seed scanning. The world generator knows nothing about the demo; these
// searches prove both outcomes genuinely occur across seeds, then the tests
// above pin whichever seed produces each one. Deterministic forever after.

type DemoOutcome = 'clean' | 'mismatch';

function simulateDemo(seed: number): DemoOutcome {
  const world = createWorld(seed);
  const quote = quoteStay(world, { roomId: '418', checkIn: FRIDAY, nights: 2 });
  const staged = advanceTick(world).world;
  const outcome = commitReservationChange(staged, {
    reservationId: 'res_18',
    roomId: '418',
    checkIn: FRIDAY,
    nights: 2,
  });
  return outcome.reservation.totalDollars === quote.totalDollars ? 'clean' : 'mismatch';
}

function findSeedWhere(outcome: DemoOutcome): number {
  for (let seed = 1; seed <= 500; seed++) {
    if (simulateDemo(seed) === outcome) return seed;
  }
  throw new Error(`no seed in 1..500 produces a ${outcome} demo — generator is broken`);
}

describe('the world generator', () => {
  it('produces both outcomes honestly across seeds', () => {
    // If either scan fails, the simulator has collapsed into theatre:
    // always-mismatch means the failure is hardcoded; always-clean means the
    // contention model does nothing.
    expect(findSeedWhere('mismatch')).toBeGreaterThan(0);
    expect(findSeedWhere('clean')).toBeGreaterThan(0);
  });
});

describe('stayDates', () => {
  it('lists the nights of a stay', () => {
    expect(stayDates('2026-09-02', 2)).toEqual(['2026-09-02', '2026-09-03']);
  });

  it('refuses stays past the window', () => {
    expect(() => stayDates('2026-09-07', 2)).toThrow(/past the bookable window/);
  });
});
