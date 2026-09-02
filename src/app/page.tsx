import Link from 'next/link';

/**
 * Placeholder home page.
 *
 * Replaced in Phase 7 by the full marketing site. It exists now only
 * so the app builds and the diagnostics page is reachable while the WebMCP loop
 * is being proven.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-6 py-16">
      <p className="text-xs font-medium tracking-[0.18em] text-ink-subtle uppercase">
        The web, with proof
      </p>
      <h1 className="mt-6 font-display text-5xl leading-[1.05] tracking-tight text-ink">
        Your agent can act.
        <br />
        Proof makes sure it happened.
      </h1>
      <p className="mt-6 max-w-lg text-lg leading-relaxed text-ink-muted">
        Give an agent a goal. Watch it work. Step in when it matters. And when it says
        “done,” know that the result has actually been checked.
      </p>
      <div className="mt-10 flex flex-wrap gap-4">
        <Link
          href="/workspace"
          className="rounded-md bg-cobalt px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-cobalt-hover"
        >
          Try Proof
        </Link>
        <Link
          href="/agent-check"
          className="rounded-md border border-line px-6 py-3 text-sm font-medium text-ink transition-colors hover:bg-sunken"
        >
          Agent diagnostics
        </Link>
      </div>
    </main>
  );
}
