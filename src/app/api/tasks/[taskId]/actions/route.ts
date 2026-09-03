import { NextResponse } from 'next/server';
import { existingWorkspaceFor, saveWorkspace, WorkspaceError } from '@/lib/http/workspace-access';
import { findRecoveryOptions } from '@/lib/proof/recovery';
import {
  getQuote,
  setConstraints,
  stageChange,
  stageRecovery,
  verifyResult,
  snapshotOf,
} from '@/lib/proof/transaction';
import { taskView } from '@/lib/http/task-view';
import type { Constraint } from '@/lib/proof/constraints';
import { CONSTRAINT_KINDS } from '@/lib/proof/constraints';

/**
 * POST /api/tasks/:id/actions — the agent's mutating surface.
 *
 * Every step an agent may drive, and nothing else. The body names the step;
 * the handlers below are the *only* sanctioned way for a browser (tool) to
 * reach the transaction loop, and none of them can approve or commit:
 * approval lives in /api/tasks/:id/approve with a nonce, and commit is
 * triggered by the application after that approval, not by a caller.
 *
 * Steps:
 *   set_goal            — record constraints (typed, never free text)
 *   quote_change        — read-only price for a proposed change
 *   stage_change        — place a proposal in the interface for review
 *   verify_result       — the checker re-reads reality and judges
 *   find_recovery_options — options after a caught mismatch
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
): Promise<NextResponse> {
  try {
    const { taskId } = await params;
    const workspace = existingWorkspaceFor(request);
    const body = (await readJson(request)) as Record<string, unknown>;
    const step = typeof body.step === 'string' ? body.step : '';

    const task = workspace.tasks.find((t) => t.id === taskId);
    if (!task) return NextResponse.json({ error: `no task "${taskId}"` }, { status: 404 });

    switch (step) {
      case 'set_goal': {
        const constraints = parseConstraints(body.constraints);
        const baseRevision = requireRevision(body.baseRevision);
        const next = setConstraints(workspace, taskId, constraints, baseRevision);
        saveWorkspace(next);
        const updated = next.tasks.find((t) => t.id === taskId)!;
        return NextResponse.json({ task: taskView(updated) });
      }

      case 'quote_change': {
        const stay = parseStay(body);
        const { quote, reservation } = getQuote(workspace, taskId, stay);
        return NextResponse.json({ quote, reservation });
      }

      case 'stage_change': {
        const stay = parseStay(body);
        const baseRevision = requireRevision(body.baseRevision);
        const staged = stageChange(workspace, taskId, stay, {
          rationale: typeof body.rationale === 'string' ? body.rationale : undefined,
          baseRevision,
        });
        saveWorkspace(staged.workspace);
        return NextResponse.json({ task: taskView(staged.task), change: staged.change });
      }

      case 'verify_result': {
        const verified = verifyResult(workspace, taskId);
        saveWorkspace(verified.workspace);
        return NextResponse.json({
          task: taskView(verified.task),
          verification: {
            matched: verified.verification.matched,
            verdicts: verified.verification.verdicts,
            unexpectedChanges: verified.verification.unexpectedChanges,
            checkedAt: verified.verification.checkedAt,
          },
        });
      }

      case 'find_recovery_options': {
        // Read-only: options are computed fresh, nothing is selected.
        const options = findRecoveryOptions(workspace, taskId);
        return NextResponse.json({ options });
      }

      case 'stage_recovery': {
        // Stages one of the recovery options through the same review path as
        // any other change. An option that violates a stated constraint is
        // stageable — the human sees the trade-off — but is never applied
        // without their explicit choice.
        const optionId = typeof body.optionId === 'string' ? body.optionId : '';
        if (!optionId) {
          return NextResponse.json(
            { error: 'optionId is required, from find_recovery_options' },
            { status: 400 },
          );
        }
        const options = findRecoveryOptions(workspace, taskId);
        const option = options.find((o) => o.id === optionId);
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

      case 'commit_change':
      case 'approve_change':
        // Explicitly refused, with the reason an agent will actually learn
        // something from (no approval tool, ever).
        return NextResponse.json(
          {
            error:
              'committing and approving are not available to agents. The person whose account this is approves the change in the interface; the application commits it.',
          },
          { status: 403 },
        );

      default:
        return NextResponse.json(
          {
            error: `unknown step "${step}"`,
            knownSteps: [
              'set_goal',
              'quote_change',
              'stage_change',
              'verify_result',
              'find_recovery_options',
              'stage_recovery',
            ],
          },
          { status: 400 },
        );
    }
  } catch (cause) {
    return errorResponse(cause);
  }
}

// ---------------------------------------------------------------------------

function requireRevision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new WorkspaceError('baseRevision must be a whole number from get_task', 400);
  }
  return value;
}

function parseStay(body: Record<string, unknown>): {
  reservationId: string;
  roomId: string;
  checkIn: string;
  nights: number;
} {
  const { reservationId, roomId, checkIn, nights } = body;
  if (typeof reservationId !== 'string' || !/^res_\w+$/.test(reservationId)) {
    throw new WorkspaceError('reservationId must be a reservation id like "res_18"', 400);
  }
  if (typeof roomId !== 'string' || !/^\d{3}$/.test(roomId)) {
    throw new WorkspaceError('roomId must be a room number like "418"', 400);
  }
  if (typeof checkIn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(checkIn)) {
    throw new WorkspaceError('checkIn must be a date like "2026-09-04"', 400);
  }
  if (typeof nights !== 'number' || !Number.isInteger(nights) || nights < 1 || nights > 7) {
    throw new WorkspaceError('nights must be a whole number from 1 to 7', 400);
  }
  return { reservationId, roomId, checkIn, nights };
}

/**
 * Coerces a tool's constraint payload into typed predicates. Free text is
 * never accepted — a constraint the server cannot evaluate is refused, not
 * stored (an unevaluable constraint would make verification meaningless).
 */
function parseConstraints(value: unknown): Constraint[] {
  if (!Array.isArray(value)) {
    throw new WorkspaceError('constraints must be a list of typed constraints', 400);
  }

  const constraints: Constraint[] = [];
  for (const raw of value) {
    if (raw === null || typeof raw !== 'object' || !('kind' in raw)) {
      throw new WorkspaceError('each constraint needs a kind', 400);
    }
    const candidate = raw as Record<string, unknown>;

    switch (candidate.kind) {
      case 'date_equals':
        if (typeof candidate.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(candidate.date)) {
          throw new WorkspaceError('date_equals needs a date like "2026-09-04"', 400);
        }
        constraints.push({ kind: 'date_equals', date: candidate.date });
        break;
      case 'room_equals':
        if (typeof candidate.roomId !== 'string' || !/^\d{3}$/.test(candidate.roomId)) {
          throw new WorkspaceError('room_equals needs a room number like "418"', 400);
        }
        constraints.push({ kind: 'room_equals', roomId: candidate.roomId });
        break;
      case 'price_at_most':
        if (
          typeof candidate.amount !== 'number' ||
          !Number.isFinite(candidate.amount) ||
          candidate.amount <= 0
        ) {
          throw new WorkspaceError('price_at_most needs a positive amount', 400);
        }
        constraints.push({ kind: 'price_at_most', amount: Math.round(candidate.amount) });
        break;
      case 'unchanged':
        if (typeof candidate.field !== 'string') {
          throw new WorkspaceError('unchanged needs a field name', 400);
        }
        if (
          !(
            [
              'reservationId',
              'checkIn',
              'roomId',
              'totalPrice',
              'guestName',
              'ratePlanId',
              'nights',
              'status',
            ] as const
          ).includes(candidate.field as never)
        ) {
          throw new WorkspaceError(
            `unchanged cannot watch "${candidate.field}" — it is not an observable field`,
            400,
          );
        }
        constraints.push({ kind: 'unchanged', field: candidate.field as 'checkIn' });
        break;
      default:
        throw new WorkspaceError(
          `"${String(candidate.kind)}" is not a constraint kind; known: ${CONSTRAINT_KINDS.join(', ')}`,
          400,
        );
    }
  }

  if (constraints.length === 0) {
    throw new WorkspaceError('at least one constraint is needed', 400);
  }
  return constraints;
}

/** Read-only view of the reservation the tools will be asked about. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
): Promise<NextResponse> {
  try {
    const { taskId } = await params;
    const workspace = existingWorkspaceFor(request);
    const task = workspace.tasks.find((t) => t.id === taskId);
    if (!task) return NextResponse.json({ error: `no task "${taskId}"` }, { status: 404 });

    const reservation = workspace.world.reservations.find((r) => r.id === task.reservationId);
    return NextResponse.json({
      task: taskView(task),
      reservation: reservation ? snapshotOf(reservation) : null,
    });
  } catch (cause) {
    return errorResponse(cause);
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
  const name = cause instanceof Error ? cause.name : '';
  if (name === 'StaleRevisionError') {
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : 'state moved on', stale: true },
      { status: 409 },
    );
  }
  const message = cause instanceof Error ? cause.message : 'something went wrong';
  return NextResponse.json({ error: message }, { status: 400 });
}
