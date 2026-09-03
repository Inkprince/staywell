import { NextResponse } from 'next/server';
import { isSameOrigin } from '@/lib/http/same-origin';
import { existingWorkspaceFor, saveWorkspace, WorkspaceError } from '@/lib/http/workspace-access';
import { payReservation, paymentMethodById } from '@/lib/staywell/world';
import { collectionForRoom } from '@/lib/staywell/catalog';

/**
 * POST /api/reservations/:id/pay — the demo checkout.
 *
 * Every method is a simulated one (see PAYMENT_METHODS); no real money moves.
 * What is real is the state change: a held booking becomes a paid, confirmed
 * stay, and the record of how it was paid becomes part of the reservation.
 */
export async function POST(
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
    const methodId = typeof body.methodId === 'string' ? body.methodId : '';
    if (!paymentMethodById(methodId)) {
      return NextResponse.json({ error: 'choose one of the demo payment options' }, { status: 400 });
    }

    const outcome = payReservation(workspace.world, reservationId, methodId);
    saveWorkspace({ ...workspace, world: outcome.world });
    return NextResponse.json({
      reservation: outcome.reservation,
      room: collectionForRoom(outcome.reservation.roomId),
    });
  } catch (cause) {
    if (cause instanceof WorkspaceError) {
      return NextResponse.json({ error: cause.message }, { status: cause.status });
    }
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : 'something went wrong' },
      { status: 400 },
    );
  }
}

async function readJson(request: Request): Promise<unknown> {
  try { return await request.json(); } catch { return {}; }
}
