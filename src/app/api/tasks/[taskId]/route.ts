import { NextResponse } from 'next/server';
import { existingWorkspaceFor, WorkspaceError } from '@/lib/http/workspace-access';
import { snapshotOf } from '@/lib/proof/transaction';
import { taskView } from '@/lib/http/task-view';

/**
 * GET /api/tasks/:id — one task, its state, constraints, staged change, and
 * verification, plus the reservation it concerns (Reality, as the site holds
 * it right now). Read-only; the shape is exactly what the task screen renders
 * from.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
): Promise<NextResponse> {
  try {
    const { taskId } = await params;
    const workspace = existingWorkspaceFor(request);
    const task = workspace.tasks.find((t) => t.id === taskId);

    if (!task) {
      return NextResponse.json({ error: `no task "${taskId}"` }, { status: 404 });
    }

    // The reservation this task is about — the one it staged a change against,
    // if any. A task with nothing staged yet concerns the guest's booking.
    const reservationId = task.staged?.request.reservationId;
    const reservation = reservationId
      ? (workspace.world.reservations.find((r) => r.id === reservationId) ?? null)
      : (workspace.world.reservations[0] ?? null);

    return NextResponse.json({
      task: taskView(task),
      reservation: reservation ? snapshotOf(reservation) : null,
    });
  } catch (cause) {
    if (cause instanceof WorkspaceError) {
      return NextResponse.json({ error: cause.message }, { status: cause.status });
    }
    return NextResponse.json({ error: 'something went wrong' }, { status: 400 });
  }
}
