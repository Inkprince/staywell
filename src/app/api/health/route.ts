import { NextResponse } from 'next/server';

/**
 * GET /api/health — liveness only.
 *
 * Touches no workspace and mints no session, so an uptime monitor can hit it
 * every few minutes without leaving a trace in the store. That is the point:
 * keep-alive pings for a free-tier deployment should be free of side effects.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ ok: true });
}
