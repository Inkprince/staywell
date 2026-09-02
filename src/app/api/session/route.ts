import { NextResponse } from 'next/server';
import { withWorkspaceCookie } from '@/lib/session';
import { workspaceFor } from '@/lib/http/workspace-access';

/**
 * GET /api/session
 *
 * Establishes (or confirms) the anonymous workspace for this browser and
 * returns its public shape: the workspace id, the demo seed, and the guest's
 * reservation — the "world" an agent will be working in.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const { workspace, minted } = workspaceFor(request);

  const body = {
    workspaceId: workspace.id,
    seed: workspace.seed,
    reservation: workspace.world.reservations[0]
      ? {
          id: workspace.world.reservations[0].id,
          guestName: workspace.world.reservations[0].guestName,
          roomId: workspace.world.reservations[0].roomId,
          checkIn: workspace.world.reservations[0].checkIn,
          nights: workspace.world.reservations[0].nights,
          totalDollars: workspace.world.reservations[0].totalDollars,
          status: workspace.world.reservations[0].status,
        }
      : null,
  };

  const response = NextResponse.json(body);
  if (minted) withWorkspaceCookie(response, workspace.id);
  return response;
}
