import { NextResponse } from 'next/server';
import {
  abandonTask,
  acceptResult,
  declineStaged,
  stageRecovery,
} from '@/lib/proof/transaction';
import { findRecoveryOptions } from '@/lib/proof/recovery';
import { existingWorkspaceFor, saveWorkspace, WorkspaceError } from '@/lib/http/workspace-access';
import { taskView } from '@/lib/http/task-view';

/**
 * POST /api/tasks/:id/decide — the human's own decisions, none of which an
 * agent can make.
 *
 *   not_yet   — send a staged change back to the drawing board
 *   keep      — after a caught mismatch, keep the result anyway
 *   recover   — stage one of the recovery options (undo it, or another room);
 *               it then waits for approval like any other change
 *   abandon   — walk away; the task closes honestly as abandoned
 *
 * Same-origin only, like approval. No nonce: nothing here releases a change —
 * `recover` only stages, and the commit still needs the approval nonce.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
): Promise<NextResponse> {
  try {
    if (!isSameOrigin(request)) {
      return NextResponse.json({ error: 'cross-origin requests are refused' }, { status: 403 });
    }

    const { taskId } = await params;
    const workspace = existingWorkspaceFor(request);
    const body = (await readJson(request)) as { decision?: unknown; optionId?: unknown };
    const decision = typeof body.decision === 'string' ? body.decision : '';

    switch (decision) {
      case 'not_yet': {
        const next = declineStaged(workspace, taskId);
        saveWorkspace(next.workspace);
        return NextResponse.json({ task: taskView(next.task) });
      }

      case 'keep': {
        const next = acceptResult(workspace, taskId);
        saveWorkspace(next.workspace);
        return NextResponse.json({ task: taskView(next.task) });
      }

      case 'recover': {
        const optionId = typeof body.optionId === 'string' ? body.optionId : '';
        if (!optionId) {
          return NextResponse.json(
            { error: 'optionId is required, from the recovery options on this task' },
            { status: 400 },
          );
        }
        const option = findRecoveryOptions(workspace, taskId).find((o) => o.id === optionId);
        if (!option || !option.request) {
          return NextResponse.json({ error: `no recovery option "${optionId}"` }, { status: 404 });
        }

        const staged = stageRecovery(workspace, taskId, {
          request: option.request,
          summary: option.summary,
        });
        saveWorkspace(staged.workspace);
        return NextResponse.json({
          task: taskView(staged.task),
          change: staged.change,
          option: {
            id: option.id,
            kind: option.kind,
            satisfies: option.satisfies,
            violates: option.violates,
          },
        });
      }

      case 'abandon': {
        const next = abandonTask(workspace, taskId);
        saveWorkspace(next.workspace);
        return NextResponse.json({ task: taskView(next.task) });
      }

      default:
        return NextResponse.json(
          {
            error: `unknown decision "${decision}"`,
            knownDecisions: ['not_yet', 'keep', 'recover', 'abandon'],
          },
          { status: 400 },
        );
    }
  } catch (cause) {
    return errorResponse(cause);
  }
}

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true; // same-origin fetches may omit the header
  try {
    const url = new URL(request.url);
    return new URL(origin).origin === url.origin;
  } catch {
    return false;
  }
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
  if (cause instanceof Error && cause.name === 'StaleRevisionError') {
    return NextResponse.json({ error: cause.message, stale: true }, { status: 409 });
  }
  const message = cause instanceof Error ? cause.message : 'something went wrong';
  return NextResponse.json({ error: message }, { status: 400 });
}
