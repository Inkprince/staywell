import { NextResponse } from 'next/server';
import {
  approveChange,
  commitStaged,
  issueApprovalNonce,
  verifyResult,
} from '@/lib/proof/transaction';
import type { Workspace } from '@/lib/store/memory';
import { isSameOrigin } from '@/lib/http/same-origin';
import { existingWorkspaceFor, saveWorkspace, WorkspaceError } from '@/lib/http/workspace-access';

/**
 * The approval channel.
 *
 * Two routes, deliberately split by who may call them:
 *
 * - `GET /api/tasks/:id/approve` — the human's browser polls this while a
 *   change is staged for review. It mints the one-time nonce and returns it
 *   *only* to a same-origin, same-session GET. A tool (or any cross-origin
 *   caller) never sees it, because WebMCP tools issue POSTs to the actions
 *   route, and the nonce is never returned by any tool response.
 *
 * - `POST /api/tasks/:id/approve` — consumes the nonce, records the human's
 *   approval, and *the application* (not the caller) commits the change and
 *   runs verification. The caller of POST is the browser form; the actor of
 *   the commit is Proof.
 */

export async function GET(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
): Promise<NextResponse> {
  try {
    const { taskId } = await params;
    const workspace = existingWorkspaceFor(request);
    const task = workspace.tasks.find((t) => t.id === taskId);
    if (!task) return NextResponse.json({ error: `no task "${taskId}"` }, { status: 404 });

    if (task.state !== 'READY_FOR_REVIEW' || !task.staged) {
      return NextResponse.json({
        state: task.state,
        nonce: null,
        message:
          task.state === 'VERIFIED'
            ? 'This task is done, and checked.'
            : 'Nothing is waiting for your approval right now.',
      });
    }

    // The nonce: minted server-side, delivered only here, consumed once.
    const { workspace: next, nonce } = issueApprovalNonce(workspace, taskId);
    saveWorkspace(next);

    return NextResponse.json({
      state: task.state,
      change: {
        id: task.staged.id,
        request: task.staged.request,
        quote: task.staged.quote,
        rationale: task.staged.rationale ?? null,
      },
      nonce: { id: nonce.id },
    });
  } catch (cause) {
    return errorResponse(cause);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
): Promise<NextResponse> {
  try {
    if (!isSameOrigin(request)) {
      return NextResponse.json({ error: 'cross-origin approvals are refused' }, { status: 403 });
    }

    const { taskId } = await params;
    const workspace = existingWorkspaceFor(request);
    const body = (await readJson(request)) as { nonceId?: unknown };
    const nonceId = typeof body.nonceId === 'string' ? body.nonceId : '';

    if (!nonceId) {
      return NextResponse.json(
        { error: 'approval requires the one-time token from this page' },
        { status: 400 },
      );
    }

    // Approval, then the application commits and checks reality itself.
    let next = approveChange(workspace, taskId, nonceId).workspace;
    const committed = commitStaged(next, taskId);
    next = committed.workspace;

    const verified = verify(next, taskId);
    saveWorkspace(verified.workspace);

    const task = verified.task;
    return NextResponse.json({
      task: {
        id: task.id,
        state: task.state,
        verification: task.verification
          ? {
              matched: task.verification.result.matched,
              verdicts: task.verification.result.verdicts,
              unexpectedChanges: task.verification.result.unexpectedChanges,
              checkedAt: task.verification.verifiedAt,
            }
          : null,
      },
      committed: {
        changeId: committed.outcome.changeId,
        observed: committed.outcome.observed,
        landed: committed.outcome.landed,
      },
    });
  } catch (cause) {
    return errorResponse(cause);
  }
}

/**
 * Commit hands off to the checker in the same request, so the human sees the
 * outcome of their approval immediately — including a mismatch, which is the
 * product's defining moment.
 */
function verify(workspace: Workspace, taskId: string) {
  try {
    return verifyResult(workspace, taskId);
  } catch {
    // A commit that landed the task somewhere verification cannot yet run
    // leaves it where the FSM put it; the interface shows that honestly.
    return { workspace, task: workspace.tasks.find((t) => t.id === taskId)! };
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
  const message = cause instanceof Error ? cause.message : 'something went wrong';
  return NextResponse.json({ error: message }, { status: 400 });
}
