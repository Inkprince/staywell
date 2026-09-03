import { NextResponse } from 'next/server';
import { existingWorkspaceFor, WorkspaceError } from '@/lib/http/workspace-access';
import { quoteStay, ROOMS, stayDates, UnavailableError } from '@/lib/staywell/world';
import { collectionForRoom } from '@/lib/staywell/catalog';

/**
 * POST /api/availability — every room, quoted fresh for a stay.
 *
 * Read-only: no engine advance, no revision bump. Availability here means
 * "bookable for this stay given the reservations the world models" — the
 * aggregate occupancy never fills the last room by construction.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const workspace = existingWorkspaceFor(request);
    const body = (await readJson(request)) as { checkIn?: unknown; nights?: unknown; guests?: unknown };

    const checkIn = typeof body.checkIn === 'string' ? body.checkIn : '';
    const nights = Number(body.nights);
    const guests = Number(body.guests ?? 1);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(checkIn) || !Number.isInteger(nights) || nights < 1 || nights > 7 || !Number.isInteger(guests) || guests < 1 || guests > 4) {
      return NextResponse.json(
        { error: 'checkIn (YYYY-MM-DD) and nights (1–7) are required' },
        { status: 400 },
      );
    }

    let dates: string[];
    try {
      dates = stayDates(checkIn, nights);
    } catch (cause) {
      return NextResponse.json(
        { error: cause instanceof Error ? cause.message : 'that stay is outside the bookable window' },
        { status: 400 },
      );
    }

    const rooms = ROOMS.map((room) => {
      const collection = collectionForRoom(room.id);
      let available = guests <= collection.maxGuests;
      let reason: string | null = null;
      if (!available) reason = `sleeps up to ${collection.maxGuests} guests`;
      try {
        if (available) {
          for (const reservation of workspace.world.reservations) {
            if (reservation.status === 'cancelled' || reservation.roomId !== room.id) continue;
            if (dates.some((d) => stayDates(reservation.checkIn, reservation.nights).includes(d))) {
              throw new UnavailableError(room.id, dates);
            }
          }
        }
      } catch {
        available = false;
        reason = 'already booked for those dates';
      }

      const quote = quoteStay(workspace.world, {
        roomId: room.id,
        checkIn,
        nights,
      });

      return {
        roomId: room.id,
        category: room.category,
        collection,
        available,
        reason,
        quote: {
          totalDollars: quote.totalDollars,
          occupancy: quote.occupancy,
          tierLabel: quote.tierLabel,
        },
      };
    });

    return NextResponse.json({ checkIn, nights, guests, rooms });
  } catch (cause) {
    if (cause instanceof WorkspaceError) {
      return NextResponse.json({ error: cause.message }, { status: cause.status });
    }
    return NextResponse.json({ error: 'something went wrong' }, { status: 400 });
  }
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}
