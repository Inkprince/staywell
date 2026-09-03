import { NextResponse } from 'next/server';
import { existingWorkspaceFor, saveWorkspace, WorkspaceError } from '@/lib/http/workspace-access';
import { snapshotOf } from '@/lib/proof/transaction';
import { commitReservationChange } from '@/lib/staywell/world';
import { collectionForRoom } from '@/lib/staywell/catalog';

/**
 * GET /api/reservations/:id — the authoritative state of one reservation.
 * Read-only; this is what `get_reservation` renders and what the checker
 * re-reads.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ reservationId: string }> },
): Promise<NextResponse> {
  try {
    const { reservationId } = await params;
    const workspace = existingWorkspaceFor(request);
    const reservation = workspace.world.reservations.find((r) => r.id === reservationId);

    if (!reservation) {
      return NextResponse.json(
        { error: `no reservation "${reservationId}" in this workspace` },
        { status: 404 },
      );
    }

    return NextResponse.json({ reservation: snapshotOf(reservation) });
  } catch (cause) {
    if (cause instanceof WorkspaceError) {
      return NextResponse.json({ error: cause.message }, { status: cause.status });
    }
    return NextResponse.json({ error: 'something went wrong' }, { status: 400 });
  }
}

/** A normal guest edit - deliberately separate from the agent/Proof path. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ reservationId: string }> },
): Promise<NextResponse> {
  try {
    if (!isSameOrigin(request)) {
      return NextResponse.json({ error: 'cross-origin requests are refused' }, { status: 403 });
    }
    const { reservationId } = await params;
    const workspace = existingWorkspaceFor(request);
    const body = (await readJson(request)) as Record<string, unknown>;
    const roomId = typeof body.roomId === 'string' ? body.roomId : '';
    const checkIn = typeof body.checkIn === 'string' ? body.checkIn : '';
    const nights = Number(body.nights);
    if (!roomId || !/^\d{4}-\d{2}-\d{2}$/.test(checkIn) || !Number.isInteger(nights) || nights < 1 || nights > 7) {
      return NextResponse.json({ error: 'choose a room, valid date, and 1–7 nights' }, { status: 400 });
    }
    const outcome = commitReservationChange(workspace.world, { reservationId, roomId, checkIn, nights });
    saveWorkspace({ ...workspace, world: outcome.world });
    return NextResponse.json({ reservation: outcome.reservation, room: collectionForRoom(roomId) });
  } catch (cause) {
    if (cause instanceof WorkspaceError) return NextResponse.json({ error: cause.message }, { status: cause.status });
    return NextResponse.json({ error: cause instanceof Error ? cause.message : 'something went wrong' }, { status: 400 });
  }
}

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

async function readJson(request: Request): Promise<unknown> {
  try { return await request.json(); } catch { return {}; }
}
