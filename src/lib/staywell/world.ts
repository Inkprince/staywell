/**
 * The StayWell hotel simulation.
 *
 * The mismatch must not be theatrical. There is no "on step 4, show $319".
 * Instead:
 *
 * - Inventory carries a **seeded schedule of competing holds** keyed to engine
 *   *ticks* — which advance on mutating calls, never on wall-clock time.
 * - Price is a yield function of occupancy: `total = base × tier(occupancy)`,
 *   always in whole dollars.
 * - When a competing hold lands between the quote and the commit, occupancy
 *   rises and the price recomputes **by the same formula that produced the
 *   quote**.
 *
 * So $294 → $319 is emergent, reproducible from a seed, and explainable in the
 * inspector as "occupancy 0.72 → 0.88, busy → high demand". A different seed
 * yields a clean success, which is itself the honest claim.
 *
 * All functions are pure: mutating operations return a new world.
 */

import { intBetween, mulberry32, pick } from './rng';
import { maxGuestsForRoom } from './catalog';

export interface Room {
  id: string;
  category: 'standard' | 'deluxe' | 'suite';
  /** Nightly base rate, in cents, before yield adjustment. */
  nightlyBaseCents: number;
  floor: number;
}

export interface Reservation {
  id: string;
  guestName: string;
  guestCount: number;
  roomId: string;
  checkIn: string;
  nights: number;
  ratePlanId: string;
  status: 'held' | 'confirmed' | 'cancelled';
  /** Whole dollars, as quoted or committed. */
  totalDollars: number;
  /** The occupancy the price was computed at, for the inspector. */
  pricedAtOccupancy: number;
  pricedAtTick: number;
  /** Present once the stay is paid for. A `held` booking has none. */
  payment?: PaymentRecord;
}

/**
 * A simulated payment. Every method here is a demo method — no real money
 * moves, nothing is charged — but the record is part of the reservation's
 * state, so "paid" and "not paid" are real states the interface can show.
 */
export interface PaymentRecord {
  methodId: string;
  label: string;
  paidAt: string;
}

/** The demo payment options every guest is offered at checkout. */
export const PAYMENT_METHODS = [
  { id: 'visa', label: 'Visa ·· 4242', detail: 'Demo card · expires 04/29' },
  { id: 'amex', label: 'Amex ·· 3005', detail: 'Demo card · expires 11/28' },
  { id: 'apple-pay', label: 'Apple Pay', detail: 'Face ID, then done' },
  { id: 'at-desk', label: 'Pay at the hotel', detail: 'Due at check-in' },
] as const;

export type PaymentMethodId = (typeof PAYMENT_METHODS)[number]['id'];

export function paymentMethodById(methodId: string):
  | { id: PaymentMethodId; label: string; detail: string }
  | null {
  return PAYMENT_METHODS.find((method) => method.id === methodId) ?? null;
}

export interface CompetingHold {
  id: string;
  /** The engine tick at which this hold lands. */
  tick: number;
  /** Dates the hold occupies, `YYYY-MM-DD`. */
  dates: string[];
  rooms: number;
  label: string;
}

export interface StayWellWorld {
  seed: number;
  revision: number;
  /** Advances only on mutating calls. */
  tick: number;
  /** Occupied room count per date (other guests, aggregate). */
  occupied: Record<string, number>;
  reservations: Reservation[];
  /** Seeded competing demand, fires when its tick is reached. */
  schedule: CompetingHold[];
  /** Holds that have already landed, in order. */
  appliedHoldIds: string[];
}

// ---------------------------------------------------------------------------
// Static hotel facts

export const TOTAL_ROOMS = 25;
export const CALENDAR = [
  '2026-09-01',
  '2026-09-02',
  '2026-09-03',
  '2026-09-04',
  '2026-09-05',
  '2026-09-06',
  '2026-09-07',
] as const;

/** Every date starts with this many rooms taken by other guests. */
const BASELINE_OCCUPIED = 18;

/**
 * Holds may never fill the last room: the world must stay committable, so a
 * mismatch is always about price, never a dead end. (Availability failures are
 * a separate, earlier check — see `assertAvailable`.)
 */
const OCCUPANCY_CEILING = TOTAL_ROOMS - 1;

function buildRooms(): Room[] {
  const rooms: Room[] = [];
  for (let n = 401; n <= 425; n++) {
    const category: Room['category'] =
      n <= 410 ? 'standard' : n <= 420 ? 'deluxe' : 'suite';
    const nightlyBaseCents =
      category === 'standard' ? 9500 : category === 'deluxe' ? 12250 : 18500;
    // Room 412 recovers more softly than 418: a lower base inside deluxe.
    const base = n === 412 ? 10550 : nightlyBaseCents;
    rooms.push({ id: String(n), category, nightlyBaseCents: base, floor: n % 100 });
  }
  return rooms;
}

export const ROOMS: readonly Room[] = buildRooms();

export function roomById(roomId: string): Room {
  const room = ROOMS.find((r) => r.id === roomId);
  if (!room) throw new Error(`unknown room "${roomId}"`);
  return room;
}

// ---------------------------------------------------------------------------
// Yield pricing

export interface PricingTier {
  /** Exclusive upper bound on occupancy. */
  maxOccupancy: number;
  /** Integer basis points, so pricing is exact integer arithmetic. */
  multiplierBp: number;
  label: string;
}

/**
 * The yield ladder. The multiplier applies to the base rate of the stay.
 * The quote and the commit both call this — one formula, no exceptions.
 */
export const PRICING_TIERS: readonly PricingTier[] = [
  { maxOccupancy: 0.55, multiplierBp: 10000, label: 'quiet' },
  { maxOccupancy: 0.7, multiplierBp: 11000, label: 'steady' },
  { maxOccupancy: 0.85, multiplierBp: 12000, label: 'busy' },
  { maxOccupancy: 1.01, multiplierBp: 13000, label: 'high demand' },
];

export function tierFor(occupancy: number): PricingTier {
  const tier = PRICING_TIERS.find((t) => occupancy < t.maxOccupancy);
  return tier ?? PRICING_TIERS[PRICING_TIERS.length - 1]!;
}

/**
 * Whole-dollar pricing: `round(base × multiplier)` with halves rounding up.
 * Integer arithmetic throughout, so the same inputs always give the same
 * price — no float drift deciding whether a guest pays $318 or $319.
 *
 * `adjustedCents` is exact; dividing by 100 yields whole dollars.
 */
export function priceStay(nightlyBaseCents: number, nights: number, multiplierBp: number): number {
  const adjustedCents = Math.floor((nightlyBaseCents * nights * multiplierBp) / 10000);
  // Round half-up to whole dollars: 31850¢ → $318.50 → $319.
  return Math.floor(adjustedCents / 100 + 0.5);
}

// ---------------------------------------------------------------------------
// World construction

const HOLD_LABELS = [
  'a regional sales team',
  'a wedding block',
  'an airline crew layover',
  'a corporate offsite',
  'a tour group',
  'overflow from a nearby event',
] as const;

/**
 * The seeded schedule of competing demand. Nothing here knows about the
 * guest's plan; holds land where the seed lands them.
 */
export function generateSchedule(seed: number): CompetingHold[] {
  const rng = mulberry32(seed);
  const count = intBetween(rng, 4, 8);
  const holds: CompetingHold[] = [];

  for (let i = 0; i < count; i++) {
    const tick = intBetween(rng, 1, 9);
    const firstDay = intBetween(rng, 0, CALENDAR.length - 1);
    const dates = [CALENDAR[firstDay]!];
    if (rng() < 0.4) {
      const second = CALENDAR[Math.min(firstDay + 1, CALENDAR.length - 1)]!;
      if (second !== dates[0]) dates.push(second);
    }
    holds.push({
      id: `hold_${seed}_${i}`,
      tick,
      dates,
      rooms: intBetween(rng, 4, 8),
      label: pick(rng, HOLD_LABELS),
    });
  }

  return holds.sort((a, b) => a.tick - b.tick);
}

export function createWorld(seed: number): StayWellWorld {
  const occupied: Record<string, number> = {};
  for (const date of CALENDAR) occupied[date] = BASELINE_OCCUPIED;

  // The guest's existing reservation, priced by the same formula as everything
  // else. Occupancy 0.72 sits in the 'busy' tier.
  const world: StayWellWorld = {
    seed,
    revision: 1,
    tick: 0,
    occupied,
    reservations: [],
    schedule: generateSchedule(seed),
    appliedHoldIds: [],
  };

  const existing = priceReservation(world, {
    id: 'res_18',
    guestName: 'Ada Lovelace',
    guestCount: 2,
    roomId: '418',
    checkIn: '2026-09-02',
    nights: 2,
    ratePlanId: 'flex',
    status: 'confirmed',
    // Paid when it was booked — a fixed timestamp keeps the world seed-
    // deterministic, which the tests rely on.
    payment: {
      methodId: 'visa',
      label: 'Visa ·· 4242',
      paidAt: '2026-08-28T10:12:00.000Z',
    },
  });

  return { ...world, reservations: [existing] };
}

// ---------------------------------------------------------------------------
// Occupancy and availability

export function stayDates(checkIn: string, nights: number): string[] {
  const start = CALENDAR.indexOf(checkIn as (typeof CALENDAR)[number]);
  if (start < 0) throw new Error(`date "${checkIn}" is outside the bookable window`);
  const dates: string[] = [];
  for (let i = 0; i < nights; i++) {
    const date = CALENDAR[start + i];
    if (!date) throw new Error(`stay extends past the bookable window`);
    dates.push(date);
  }
  return dates;
}

/** Mean occupancy across the stay's nights — the yield input. */
export function occupancyFor(world: StayWellWorld, dates: readonly string[]): number {
  const total = dates.reduce((sum, date) => sum + (world.occupied[date] ?? 0), 0);
  return total / (dates.length * TOTAL_ROOMS);
}

export class UnavailableError extends Error {
  constructor(
    readonly roomId: string,
    readonly dates: readonly string[],
  ) {
    super(`room ${roomId} is not available for ${dates.join(', ')}`);
    this.name = 'UnavailableError';
  }
}

export class CapacityError extends Error {
  constructor(
    readonly roomId: string,
    readonly guestCount: number,
    readonly maximumGuests: number,
  ) {
    super(`room ${roomId} accommodates up to ${maximumGuests} guest${maximumGuests === 1 ? '' : 's'}`);
    this.name = 'CapacityError';
  }
}

export function assertGuestCapacity(roomId: string, guestCount: number): void {
  const maximumGuests = maxGuestsForRoom(roomId);
  if (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > maximumGuests) {
    throw new CapacityError(roomId, guestCount, maximumGuests);
  }
}

/**
 * The room must be free of *modelled* reservations and the dates must have
 * capacity. Aggregate occupancy already leaves one room by construction.
 */
export function assertAvailable(world: StayWellWorld, roomId: string, dates: readonly string[]): void {
  for (const reservation of world.reservations) {
    if (reservation.status === 'cancelled') continue;
    if (reservation.roomId !== roomId) continue;
    const theirs = stayDates(reservation.checkIn, reservation.nights);
    if (dates.some((date) => theirs.includes(date))) {
      throw new UnavailableError(roomId, dates);
    }
  }
  for (const date of dates) {
    if ((world.occupied[date] ?? 0) >= TOTAL_ROOMS) {
      throw new UnavailableError(roomId, dates);
    }
  }
}

// ---------------------------------------------------------------------------
// The engine: ticks, holds, pricing, commit

export interface Quote {
  roomId: string;
  checkIn: string;
  nights: number;
  totalDollars: number;
  occupancy: number;
  multiplier: number;
  tierLabel: string;
  /** The engine tick this quote was computed at. */
  tick: number;
}

function priceReservation(world: StayWellWorld, reservation: Omit<Reservation, 'totalDollars' | 'pricedAtOccupancy' | 'pricedAtTick'>): Reservation {
  const room = roomById(reservation.roomId);
  const dates = stayDates(reservation.checkIn, reservation.nights);
  const occupancy = occupancyFor(world, dates);
  const tier = tierFor(occupancy);

  return {
    ...reservation,
    totalDollars: priceStay(room.nightlyBaseCents, reservation.nights, tier.multiplierBp),
    pricedAtOccupancy: Math.round(occupancy * 100) / 100,
    pricedAtTick: world.tick,
  };
}

/** Read-only: quotes never advance the engine. */
export function quoteStay(
  world: StayWellWorld,
  stay: { roomId: string; checkIn: string; nights: number },
): Quote {
  const room = roomById(stay.roomId);
  const dates = stayDates(stay.checkIn, stay.nights);
  const occupancy = occupancyFor(world, dates);
  const tier = tierFor(occupancy);

  return {
    roomId: stay.roomId,
    checkIn: stay.checkIn,
    nights: stay.nights,
    totalDollars: priceStay(room.nightlyBaseCents, stay.nights, tier.multiplierBp),
    occupancy: Math.round(occupancy * 100) / 100,
    multiplier: tier.multiplierBp / 10000,
    tierLabel: tier.label,
    tick: world.tick,
  };
}

/**
 * Lands every scheduled hold whose tick has been reached. Called from
 * `advanceTick` only — the engine decides when demand arrives, not the caller.
 */
function applyDueHolds(world: StayWellWorld): { world: StayWellWorld; landed: CompetingHold[] } {
  const due = world.schedule.filter(
    (hold) => hold.tick <= world.tick && !world.appliedHoldIds.includes(hold.id),
  );
  if (due.length === 0) return { world, landed: [] };

  const occupied = { ...world.occupied };
  for (const hold of due) {
    for (const date of hold.dates) {
      occupied[date] = Math.min((occupied[date] ?? 0) + hold.rooms, OCCUPANCY_CEILING);
    }
  }

  return {
    world: {
      ...world,
      occupied,
      appliedHoldIds: [...world.appliedHoldIds, ...due.map((h) => h.id)],
    },
    landed: due,
  };
}

/**
 * Advances the engine one tick, landing any demand due in the meantime.
 * Mutating tool calls invoke this — reads never do.
 */
export function advanceTick(world: StayWellWorld): { world: StayWellWorld; landed: CompetingHold[] } {
  return applyDueHolds({ ...world, tick: world.tick + 1 });
}

export interface CommitRequest {
  reservationId: string;
  roomId: string;
  checkIn: string;
  nights: number;
}

export interface CommitOutcome {
  world: StayWellWorld;
  reservation: Reservation;
  /** Holds that landed as part of this commit, for the inspector. */
  landed: CompetingHold[];
}

/**
 * Creates a new guest reservation from the same live inventory and pricing
 * engine used by amendments. Booking is a normal human hotel action; Proof is
 * only needed when someone wants help changing an existing stay.
 *
 * A fresh booking is **held, not confirmed**: it holds the room, and the stay
 * becomes real when the guest pays (`payReservation`). Held rooms are not
 * bookable by anyone else — the hold is honest inventory.
 */
export function bookReservation(
  world: StayWellWorld,
  request: Omit<CommitRequest, 'reservationId'> & { guestName: string; guestCount: number },
): CommitOutcome {
  const dates = stayDates(request.checkIn, request.nights);
  assertGuestCapacity(request.roomId, request.guestCount);
  assertAvailable(world, request.roomId, dates);
  const { world: ticked, landed } = advanceTick(world);
  const id = `res_${ticked.revision + ticked.reservations.length + 1}`;
  const reservation = priceReservation(ticked, {
    id,
    guestName: request.guestName,
    guestCount: request.guestCount,
    roomId: request.roomId,
    checkIn: request.checkIn,
    nights: request.nights,
    ratePlanId: 'flex',
    status: 'held',
  });
  return {
    world: {
      ...ticked,
      revision: world.revision + 1,
      reservations: [...ticked.reservations, reservation],
    },
    reservation,
    landed,
  };
}

/**
 * Commits a change to a reservation: availability check, engine advance, and a
 * **fresh price** — computed after any demand that just landed, by the same
 * formula as the quote. This is where a $294 quote can honestly become a $319
 * reservation.
 *
 * Revision checking is deliberately absent: optimistic concurrency is the
 * owning layer's job (`lib/proof/revisions.ts`), which guards the call. The
 * world's revision *bumps* here because a world mutation happened.
 */
export function commitReservationChange(
  world: StayWellWorld,
  request: CommitRequest,
): CommitOutcome {
  const reservation = world.reservations.find((r) => r.id === request.reservationId);
  if (!reservation) throw new Error(`unknown reservation "${request.reservationId}"`);

  const dates = stayDates(request.checkIn, request.nights);
  assertGuestCapacity(request.roomId, reservation.guestCount);
  const availabilityWorld = {
    ...world,
    reservations: world.reservations.filter((r) => r.id !== request.reservationId),
  };
  assertAvailable(availabilityWorld, request.roomId, dates);

  const { world: ticked, landed } = advanceTick(world);
  const priced: Reservation = priceReservation(ticked, {
    ...reservation,
    roomId: request.roomId,
    checkIn: request.checkIn,
    nights: request.nights,
    // Paid stays stay paid (and unpaid stays stay unpaid): a change of plan
    // is not a payment event.
    status: reservation.status,
  });

  const next: StayWellWorld = {
    ...ticked,
    revision: world.revision + 1,
    reservations: ticked.reservations.map((r) => (r.id === priced.id ? priced : r)),
  };

  return { world: next, reservation: priced, landed };
}

export interface PaymentOutcome {
  world: StayWellWorld;
  reservation: Reservation;
}

/**
 * Pays for a held booking with one of the demo methods. Pure, like every
 * mutating operation: a new world, the old one untouched.
 *
 * The revision bumps with the payment — the world genuinely moved — so a
 * change staged against the unpaid world is honestly stale, exactly like a
 * change staged before any other world event.
 */
export function payReservation(
  world: StayWellWorld,
  reservationId: string,
  methodId: string,
): PaymentOutcome {
  const reservation = world.reservations.find((r) => r.id === reservationId);
  if (!reservation) throw new Error(`unknown reservation "${reservationId}"`);

  if (reservation.status === 'cancelled') {
    throw new Error('a cancelled reservation cannot be paid');
  }
  if (reservation.status === 'confirmed') {
    throw new Error('this reservation is already paid for');
  }

  const method = paymentMethodById(methodId);
  if (!method) throw new Error(`unknown payment method "${methodId}"`);

  const paid: Reservation = {
    ...reservation,
    status: 'confirmed',
    payment: {
      methodId: method.id,
      label: method.label,
      paidAt: new Date().toISOString(),
    },
  };

  return {
    world: {
      ...world,
      revision: world.revision + 1,
      reservations: world.reservations.map((r) => (r.id === paid.id ? paid : r)),
    },
    reservation: paid,
  };
}
