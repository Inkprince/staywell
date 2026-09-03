import { NextResponse } from 'next/server';
import { existingWorkspaceFor, saveWorkspace, WorkspaceError } from '@/lib/http/workspace-access';
import { bookReservation, quoteStay, stayDates, UnavailableError, CapacityError } from '@/lib/staywell/world';
import { collectionForRoom } from '@/lib/staywell/catalog';

/** The normal guest booking surface. It uses the same world as Proof. */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const workspace = existingWorkspaceFor(request);
    return NextResponse.json({
      reservations: workspace.world.reservations.map((reservation) => ({
        ...reservation,
        room: collectionForRoom(reservation.roomId),
      })),
    });
  } catch (cause) {
    return errorResponse(cause);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    if (!isSameOrigin(request)) {
      return NextResponse.json({ error: 'cross-origin requests are refused' }, { status: 403 });
    }
    const workspace = existingWorkspaceFor(request);
    const body = (await readJson(request)) as Record<string, unknown>;
    const roomId = typeof body.roomId === 'string' ? body.roomId : '';
    const checkIn = typeof body.checkIn === 'string' ? body.checkIn : '';
    const nights = Number(body.nights);
    const guestCount = Number(body.guestCount);
    const guestName = typeof body.guestName === 'string' ? body.guestName.trim() : '';
    if (!roomId || !/^\d{4}-\d{2}-\d{2}$/.test(checkIn) || !Number.isInteger(nights) || nights < 1 || nights > 7) {
      return NextResponse.json({ error: 'choose a room, a valid check-in date, and 1–7 nights' }, { status: 400 });
    }
    if (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > 4) {
      return NextResponse.json({ error: 'choose between 1 and 4 guests' }, { status: 400 });
    }
    if (guestName.length < 2 || guestName.length > 80) {
      return NextResponse.json({ error: 'enter the lead guest name (2 to 80 characters)' }, { status: 400 });
    }
    stayDates(checkIn, nights);
    // Quote before booking so the confirmation can describe the price that was
    // actually shown to the guest. `bookReservation` recalculates the real
    // final price after its normal world tick.
    const quoted = quoteStay(workspace.world, { roomId, checkIn, nights });
    const outcome = bookReservation(workspace.world, { roomId, checkIn, nights, guestName, guestCount });
    saveWorkspace({ ...workspace, world: outcome.world });
    return NextResponse.json({
      reservation: outcome.reservation,
      room: collectionForRoom(outcome.reservation.roomId),
      quote: quoted,
    }, { status: 201 });
  } catch (cause) {
    if (cause instanceof CapacityError) {
      return NextResponse.json({ error: cause.message }, { status: 400 });
    }
    if (cause instanceof UnavailableError) {
      return NextResponse.json({ error: 'that room was just taken for those dates' }, { status: 409 });
    }
    return errorResponse(cause);
  }
}

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  return origin === new URL(request.url).origin;
}

async function readJson(request: Request): Promise<unknown> {
  try { return await request.json(); } catch { return {}; }
}

function errorResponse(cause: unknown): NextResponse {
  if (cause instanceof WorkspaceError) return NextResponse.json({ error: cause.message }, { status: cause.status });
  const message = cause instanceof Error ? cause.message : 'something went wrong';
  return NextResponse.json({ error: message }, { status: 400 });
}
