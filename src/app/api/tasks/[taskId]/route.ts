import { NextResponse } from 'next/server';
import { existingWorkspaceFor, WorkspaceError } from '@/lib/http/workspace-access';
import type { ProofTask } from '@/lib/proof/task';
import { taskView } from '../route';

/**
 * GET /api/tasks/:id — one task, its state, constraints, staged change, and
 * verification. Read-only; the shape is exactly what the tool surface and the
 * task screen render from.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
): Promise<NextResponse> {
  try {
    const { taskId } = await params;
    const workspace = existingWorkspaceFor(request);
    const task = workspace.tasks.find((t: ProofTask) => t.id === taskId);

    if (!task) {
      return NextResponse.json({ error: `no task "${taskId}"` }, { status: 404 });
    }

    return NextResponse.json({ task: taskView(task) });
  } catch (cause) {
    if (cause instanceof WorkspaceError) {
      return NextResponse.json({ error: cause.message }, { status: cause.status });
    }
    return NextResponse.json({ error: 'something went wrong' }, { status: 400 });
  }
}
