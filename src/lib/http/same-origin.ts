/**
 * The same-origin gate every mutating route runs before it touches state.
 *
 * Browsers attach an `Origin` header to cross-site requests — and to same-origin
 * POSTs — so whenever it is present it must match the host the request actually
 * arrived on. Anything else is a cross-origin caller and is refused.
 *
 * Behind a proxy (Render, Fly.io, any TLS terminator) the request URL is the
 * internal one — `http://localhost:…` — so the public host and scheme are read
 * from the forwarding headers the proxy sets. The proxy is the only way in, and
 * it overwrites those headers, so they are trustworthy there; with no proxy in
 * play the request URL itself is the truth, which is the local case.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true; // same-origin fetches and form posts may omit it
  try {
    const url = new URL(request.url);
    const host =
      request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ??
      request.headers.get('host') ??
      url.host;
    const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ?? url.protocol.replace(':', '');
    const expected = new URL(`${proto}://${host}`).origin;
    return new URL(origin).origin === expected;
  } catch {
    return false;
  }
}
