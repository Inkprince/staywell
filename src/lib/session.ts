import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

/**
 * Anonymous workspace identity.
 *
 * Cookie primary, with `?w=` fallback so identity survives in embedded
 * browsers that restrict cookies (ChatGPT's in-app browser among them). The
 * workspace id is a random id, not a secret: knowing it lets you observe and
 * work in that workspace — every consequential action still requires a human
 * approval from a live browser session.
 */

const WORKSPACE_COOKIE = 'proof_w';
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

function newWorkspaceId(): string {
  return `ws_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`;
}

export function workspaceIdFromCookie(cookieHeader: string): string | null {
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${WORKSPACE_COOKIE}=([^;]+)`));
  return match ? decodeURIComponent(match[1]!) : null;
}

/**
 * Resolves the caller's workspace id from the cookie, or from the `?w=` URL
 * parameter, minting a fresh one when neither is present.
 *
 * `?seed=` may also be given to fix the demo world's seed; it only takes
 * effect when a workspace is being minted (existing workspaces keep their
 * world).
 */
export function resolveWorkspaceId(request: Request): {
  workspaceId: string;
  minted: boolean;
  seed: number | null;
} {
  const cookieId = workspaceIdFromCookie(request.headers.get('cookie') ?? '');
  if (cookieId) return { workspaceId: cookieId, minted: false, seed: null };

  const url = new URL(request.url);
  const fromQuery = url.searchParams.get('w');
  if (fromQuery) return { workspaceId: fromQuery, minted: false, seed: null };

  const seedParam = url.searchParams.get('seed');
  const seed = seedParam !== null && /^\d+$/.test(seedParam) ? Number(seedParam) : null;
  return { workspaceId: newWorkspaceId(), minted: true, seed };
}

/** The response cookie that makes the minted id stick. */
export function withWorkspaceCookie<T extends NextResponse>(
  response: T,
  workspaceId: string,
): T {
  response.cookies.set({
    name: WORKSPACE_COOKIE,
    value: workspaceId,
    httpOnly: false, // the client side needs to read it for ?w= fallbacks
    sameSite: 'lax',
    path: '/',
    maxAge: ONE_YEAR_SECONDS,
  });
  return response;
}

/** Server-side form, for use inside route handlers with `cookies()`. */
export async function currentWorkspaceId(): Promise<string | null> {
  const store = await cookies();
  return store.get(WORKSPACE_COOKIE)?.value ?? null;
}
