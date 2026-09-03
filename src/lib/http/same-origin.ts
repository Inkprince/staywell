/**
 * The origin a request actually arrived on.
 *
 * Behind a proxy (Render, Fly.io, any TLS terminator) the request URL is the
 * internal one — and, worse, its scheme may be rebuilt from the forwarded
 * proto while the host stays internal, producing an origin nothing can fetch.
 * The public host and scheme come from the forwarding headers the proxy sets;
 * the proxy is the only way in and overwrites them, so they are trustworthy
 * there. With no proxy in play the request URL itself is the truth, which is
 * the local case.
 */
export function publicOrigin(request: Request): string {
  const url = new URL(request.url);
  const host =
    request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ??
    request.headers.get('host') ??
    url.host;
  const proto =
    request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ??
    url.protocol.replace(':', '');
  return new URL(`${proto}://${host}`).origin;
}

/**
 * The same-origin gate every mutating route runs before it touches state.
 *
 * Browsers attach an `Origin` header to cross-site requests — and to same-origin
 * POSTs — so whenever it is present it must match the host the request actually
 * arrived on. Anything else is a cross-origin caller and is refused.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true; // same-origin fetches and form posts may omit it
  try {
    return new URL(origin).origin === publicOrigin(request);
  } catch {
    return false;
  }
}
