import Link from 'next/link';
import { HeroDemo } from '@/features/home/hero-demo';
import { AgentBadge } from '@/features/home/agent-badge';

/**
 * The marketing site: the problem ("'Done' isn't proof"), the
 * product in three words (Plan. Act. Check.), human control, the mismatch —
 * and a hero that demonstrates itself: the miniature task is a real task in a
 * real workspace, not an animation.
 *
 * Copy rules (§36) hold throughout: no "agentic orchestration," no magic —
 * plain words for what actually happens.
 */
export default function HomePage() {
  return (
    <main>
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <p className="font-display text-xl tracking-tight text-ink">Proof</p>
        <div className="flex items-center gap-4">
          <AgentBadge />
          <Link
            href="/workspace"
            className="text-sm font-medium text-ink transition-colors hover:text-cobalt"
          >
            Open the workspace
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 pt-10 pb-20 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <p className="text-xs font-medium tracking-[0.18em] text-ink-subtle uppercase">
            The web, with proof
          </p>
          <h1 className="mt-5 font-display text-5xl leading-[1.05] tracking-tight text-ink sm:text-6xl">
            Your agent can act.
            <br />
            Proof makes sure it happened.
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-relaxed text-ink-muted">
            Give an agent a goal. Watch it work. Step in when it matters. And when it says
            “done,” know that the result has actually been checked.
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            <Link
              href="/workspace"
              className="rounded-md bg-cobalt px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-cobalt-hover"
            >
              Try Proof
            </Link>
            <Link
              href="#how-it-works"
              className="rounded-md border border-line px-6 py-3 text-sm font-medium text-ink transition-colors hover:bg-sunken"
            >
              See how it works
            </Link>
          </div>
          <p className="mt-6 text-sm text-ink-subtle">
            Don’t take “done” for an answer.
          </p>
        </div>

        <HeroDemo />
      </section>

      {/* Problem */}
      <section className="border-t border-line bg-sunken/50">
        <div className="mx-auto max-w-3xl px-6 py-24 text-center">
          <h2 className="font-display text-4xl text-ink">“Done” isn’t proof.</h2>
          <div className="mx-auto mt-10 max-w-xl rounded-2xl border border-line bg-surface p-8 text-left shadow-sm">
            <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">
              An agent, replying
            </p>
            <p className="mt-3 text-lg text-ink">“Your reservation has been changed.”</p>
          </div>
          <p className="mt-8 text-xl text-ink-muted">But did it actually happen?</p>
          <p className="mx-auto mt-4 max-w-xl text-ink-muted">
            Agents are getting good at acting. The missing piece is confidence: knowing the
            world really changed the way you asked — not because someone said so, but
            because it was checked.
          </p>
        </div>
      </section>

      {/* Product */}
      <section id="how-it-works" className="mx-auto max-w-6xl px-6 py-24">
        <h2 className="font-display text-4xl text-ink">Plan. Act. Check.</h2>
        <p className="mt-4 max-w-xl text-ink-muted">
            Three steps, in order, every time. The last one is the one everyone else skips.
        </p>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          <StepCard
            title="Plan"
            body="Your ask becomes conditions the site itself can check: a date, a room, a price. Not vibes — predicates."
          />
          <StepCard
            title="Act"
            body="The agent works out how to get there and prepares the change. Preparing is all it can do; applying it takes a person."
          />
          <StepCard
            title="Check"
            body="After the change, the site re-reads its own state and compares it with what you asked. Only then is anything called done."
          />
        </div>
      </section>

      {/* Human control */}
      <section className="border-t border-line bg-sunken/50">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 py-24 md:grid-cols-2 md:items-center">
          <div>
            <h2 className="font-display text-4xl text-ink">You stay in charge.</h2>
            <p className="mt-4 text-ink-muted">
              An agent can read, plan, quote, and propose. It cannot approve, commit, or
              declare success — those buttons don’t exist on its side of the line. Every
              consequential change waits on a screen, in front of you, showing exactly what
              will change and what stays the same.
            </p>
            <p className="mt-4 text-ink-muted">
              And nothing is ever described as finished by the agent’s say-so. Reality is
              read again, after the change, by the site itself.
            </p>
          </div>
          <ul className="space-y-4">
            <ControlLine what="The agent can" detail="read the task, quote prices, prepare a change" />
            <ControlLine what="Only you can" detail="approve it" />
            <ControlLine what="Only the site can" detail="apply it and check the result" />
            <ControlLine what="Nobody can" detail="call it done without the check passing" />
          </ul>
        </div>
      </section>

      {/* Mismatch */}
      <section className="mx-auto max-w-4xl px-6 py-24">
        <h2 className="font-display text-4xl text-ink">
          When reality disagrees, Proof tells you.
        </h2>
        <p className="mt-4 max-w-2xl text-ink-muted">
          A quote said $294. Competing demand landed between the plan and the approval, and
          the site honestly charged $319. Most software would report success. Proof reports
          the difference:
        </p>
        <div className="mt-10 rounded-2xl border border-mismatch-line bg-mismatch-soft/60 p-8">
          <div className="grid gap-8 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">
                You asked for
              </p>
              <ul className="mt-3 space-y-1.5 text-sm text-ink">
                <li>✓ Check in on Friday</li>
                <li>✓ Same room</li>
                <li>✕ Total at most $300</li>
              </ul>
            </div>
            <div>
              <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">
                What actually happened
              </p>
              <ul className="mt-3 space-y-1.5 text-sm text-ink">
                <li>Friday, Sep 4 — Room 418</li>
                <li>Total is $319</li>
              </ul>
            </div>
          </div>
          <p className="mt-8 text-lg text-ink">
            We haven’t called this complete.
          </p>
          <p className="mt-2 text-sm text-ink-muted">
            Then the choice is yours: undo it, keep it knowing the difference, or look for
            another way — with every option showing exactly which of your conditions it
            meets and which it breaks.
          </p>
        </div>
        <p className="mt-6 text-sm text-ink-subtle">
          This is the demo, and it’s real: it happens because the price is computed fresh,
          not frozen, and the check runs after the change — not before.
        </p>
      </section>

      {/* Use cases */}
      <section className="border-t border-line bg-sunken/50">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <h2 className="font-display text-4xl text-ink">Where this matters</h2>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            <UseCase
              title="Travel"
              body="Change bookings without losing track of the details."
              example="“Move my stay to Friday — same room, under $300.”"
            />
            <UseCase
              title="Shopping"
              body="Let an agent handle the work without losing your constraints."
              example="“Rebook this at a better price, same dates.”"
            />
            <UseCase
              title="Everyday tasks"
              body="Get things done across the web without wondering what happened afterward."
              example="“Cancel the renewal and confirm it’s really gone.”"
            />
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-3xl px-6 py-28 text-center">
        <h2 className="font-display text-5xl leading-[1.1] tracking-tight text-ink">
          Ask for something.
          <br />
          We’ll show you what happened.
        </h2>
        <Link
          href="/workspace"
          className="mt-10 inline-block rounded-md bg-cobalt px-8 py-4 text-base font-medium text-white transition-colors hover:bg-cobalt-hover"
        >
          Try Proof
        </Link>
        <p className="mt-6 text-sm text-ink-subtle">
          No account. A simulated hotel, a real check, and an honest answer.
        </p>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-sm text-ink-subtle">
          <p>Proof — don’t take “done” for an answer.</p>
          <div className="flex gap-6">
            <Link href="/workspace" className="transition-colors hover:text-ink">
              Workspace
            </Link>
            <Link href="/agent-check" className="transition-colors hover:text-ink">
              Agent diagnostics
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

function StepCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-7">
      <p className="font-display text-2xl text-ink">{title}</p>
      <p className="mt-3 leading-relaxed text-ink-muted">{body}</p>
    </div>
  );
}

function ControlLine({ what, detail }: { what: string; detail: string }) {
  return (
    <li className="flex items-baseline gap-3 rounded-xl border border-line bg-surface px-5 py-4">
      <span className="shrink-0 text-sm font-medium text-ink">{what}</span>
      <span className="text-sm text-ink-muted">{detail}</span>
    </li>
  );
}

function UseCase({ title, body, example }: { title: string; body: string; example: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-7">
      <p className="font-display text-2xl text-ink">{title}</p>
      <p className="mt-3 leading-relaxed text-ink-muted">{body}</p>
      <p className="mt-4 border-t border-line pt-4 text-sm text-ink-subtle">{example}</p>
    </div>
  );
}
