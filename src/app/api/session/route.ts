import { NextResponse } from 'next/server';
import { newWorkspaceId, withWorkspaceCookie } from '@/lib/session';
import { workspaceFor } from '@/lib/http/workspace-access';
import { DEFAULT_DEMO_SEED, memoryStore } from '@/lib/store/memory';

/**
 * GET /api/session
 *
 * Establishes (or confirms) the anonymous workspace for this browser and
 * returns its public shape: the workspace id, the demo seed, the demo guest
 * every workspace starts as, and their reservation — the "world" an agent
 * will be working in.
 *
 * POST /api/session
 *
 * "Reset demo": mints a brand-new workspace at the canonical demo seed and
 * moves this browser onto it. The demo world's story depends on where it is
 * in its life (a quoted $294 becomes a quoted $319 once the seeded demand
 * lands), so a presenter — or anyone who has been clicking around — gets the
 * canonical first-run world back with one call.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const { workspace, minted } = workspaceFor(request);
  const response = sessionBody(workspace);
  return minted ? withWorkspaceCookie(response, workspace.id) : response;
}

export async function POST(): Promise<NextResponse> {
  const workspace = memoryStore.createWorkspace(newWorkspaceId(), DEFAULT_DEMO_SEED);
  return withWorkspaceCookie(sessionBody(workspace), workspace.id);
}

function sessionBody(workspace: ReturnType<typeof workspaceFor>['workspace']) {
  const reservation = workspace.world.reservations[0];

  return NextResponse.json({
    workspaceId: workspace.id,
    seed: workspace.seed,
    /** The demo guest this session plays — the person on the seeded stay. */
    guest: {
      name: reservation?.guestName ?? 'Demo guest',
      demo: true,
    },
    reservation: reservation
      ? {
          id: reservation.id,
          guestName: reservation.guestName,
          roomId: reservation.roomId,
          checkIn: reservation.checkIn,
          nights: reservation.nights,
          totalDollars: reservation.totalDollars,
          status: reservation.status,
        }
      : null,
  });
}
