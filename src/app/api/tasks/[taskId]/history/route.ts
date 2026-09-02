import { NextResponse } from 'next/server';
import { existingWorkspaceFor, WorkspaceError } from '@/lib/http/workspace-access';

/**
 * GET /api/tasks/:id/history — the audit trail, newest last (chronological).
 *
 * The events are already shaped for reading: each carries its type, the task,
 * and whatever that event recorded. This is what the timeline renders and
 * what `get_task_history` returns to an agent.
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

    const events = workspace.audit.filter((e) => e.type === 'task_created' || 'taskId' in e ? (e as { taskId?: string }).taskId === taskId : false);

    return NextResponse.json({ events });
  } catch (cause) {
    if (cause instanceof WorkspaceError) {
      return NextResponse.json({ error: cause.message }, { status: cause.status });
    }
    return NextResponse.json({ error: 'something went wrong' }, { status: 400 });
  }
}
