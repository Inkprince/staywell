import { NextResponse } from 'next/server';
import { existingWorkspaceFor, saveWorkspace, WorkspaceError } from '@/lib/http/workspace-access';
import { startTask } from '@/lib/proof/transaction';

/**
 * GET /api/tasks            — every task in this workspace, newest first
 * POST /api/tasks           — create a task from the human's plain words
 *
 * The goal arrives as the person typed it. Constraint *parsing* is a separate,
 * later step (`refine_constraints`/the pilot) — a goal is never trusted as a
 * typed predicate.
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const workspace = existingWorkspaceFor(request);
    const tasks = [...workspace.tasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return NextResponse.json({ tasks: tasks.map(taskView) });
  } catch (cause) {
    return errorResponse(cause);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const workspace = existingWorkspaceFor(request);
    const body = (await readJson(request)) as { goal?: unknown };
    const goal = typeof body.goal === 'string' ? body.goal.trim() : '';

    if (!goal) {
      return NextResponse.json({ error: 'a task needs a goal, in your words' }, { status: 400 });
    }
    if (goal.length > 500) {
      return NextResponse.json({ error: 'that goal is too long — keep it under 500 characters' }, { status: 400 });
    }

    const { workspace: next, task } = startTask(workspace, goal);
    saveWorkspace(next);

    return NextResponse.json({ task: taskView(task) }, { status: 201 });
  } catch (cause) {
    return errorResponse(cause);
  }
}

// ---------------------------------------------------------------------------

/**
 * The client- and agent-visible shape of a task. Notably *excludes* approval
 * nonces and any store internals — the tool surface renders from this, so
 * nothing private can leak through it.
 */
export function taskView(task: import('@/lib/proof/task').ProofTask) {
  return {
    id: task.id,
    goal: task.goal,
    state: task.state,
    revision: task.revision,
    constraints: task.constraints,
    staged: task.staged
      ? {
          id: task.staged.id,
          request: task.staged.request,
          quote: task.staged.quote,
          rationale: task.staged.rationale ?? null,
          baseRevision: task.staged.baseRevision,
          stagedAt: task.staged.stagedAt,
        }
      : null,
    verification: task.verification
      ? {
          matched: task.verification.result.matched,
          verdicts: task.verification.result.verdicts,
          unexpectedChanges: task.verification.result.unexpectedChanges,
          checkedAt: task.verification.verifiedAt,
        }
      : null,
    approved: task.approvals.length > 0,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function errorResponse(cause: unknown): NextResponse {
  if (cause instanceof WorkspaceError) {
    return NextResponse.json({ error: cause.message }, { status: cause.status });
  }
  const message = cause instanceof Error ? cause.message : 'something went wrong';
  return NextResponse.json({ error: message }, { status: 400 });
}
