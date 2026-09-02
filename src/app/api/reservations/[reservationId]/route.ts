import { NextResponse } from 'next/server';
import { existingWorkspaceFor, WorkspaceError } from '@/lib/http/workspace-access';
import { snapshotOf } from '@/lib/proof/transaction';

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
