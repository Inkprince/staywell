'use client';

/**
 * The workspace: a greeting, one enormous input, examples in the
 * visitor's own words — and no dashboards, no agent jargon.
 *
 * The input creates the task in the human's words. Typed constraints arrive
 * later, from the agent (or the pilot) — a goal is never trusted as a
 * predicate.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { PublicTask } from '@/lib/http/task-view';
import { STATE_LABELS } from '@/features/workspace/humanize';

const EXAMPLES = [
  'Move my reservation to Friday without spending more than $300.',
  'Move me to a quieter room for the same nights.',
  'Keep my room, but make the stay one night shorter.',
];

function greetingFor(hour: number): string {
  if (hour < 5) return 'Up late.';
  if (hour < 12) return 'Good morning.';
  if (hour < 18) return 'Good afternoon.';
  return 'Good evening.';
}

export default function WorkspacePage() {
  const [tasks, setTasks] = useState<PublicTask[]>([]);
  const [goal, setGoal] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [greeting, setGreeting] = useState('Hello.');

  useEffect(() => {
    setGreeting(greetingFor(new Date().getHours()));
  }, []);

  const refresh = useCallback(async () => {
    try {
      let response = await fetch('/api/tasks');
      if (response.status === 404) {
        // No session yet — mint one, then retry.
        await fetch('/api/session');
        response = await fetch('/api/tasks');
      }
      if (!response.ok) return;
      const body = (await response.json()) as { tasks?: PublicTask[] };
      setTasks(body.tasks ?? []);
    } catch {
      // The page keeps whatever it already loaded.
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const startTask = useCallback(
    async (words: string) => {
      const trimmed = words.trim();
      if (!trimmed || busy) return;
      setBusy(true);
      setError(null);
      try {
        await fetch('/api/session');
        const response = await fetch('/api/tasks', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ goal: trimmed }),
        });
        const body = (await response.json()) as { task?: PublicTask; error?: string };
        if (!response.ok || !body.task) {
          setError(body.error ?? 'could not start that task');
          return;
        }
        setGoal('');
        window.location.href = `/workspace/${body.task.id}`;
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );

  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <Link
        href="/"
        className="text-sm text-ink-subtle transition-colors hover:text-ink"
      >
        Proof
      </Link>

      <h1 className="mt-10 font-display text-5xl leading-tight tracking-tight text-ink">
        {greeting}
      </h1>
      <p className="mt-3 text-xl text-ink-muted">What would you like to get done?</p>

      <form
        className="mt-10"
        onSubmit={(event) => {
          event.preventDefault();
          void startTask(goal);
        }}
      >
        <label htmlFor="goal" className="sr-only">
          Tell Proof what you want to accomplish
        </label>
        <textarea
          id="goal"
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          rows={3}
          placeholder="Tell Proof what you want to accomplish…"
          className="w-full rounded-xl border border-line bg-surface px-5 py-4 text-lg text-ink shadow-sm placeholder:text-ink-subtle focus:border-cobalt focus:outline-none"
        />
        <div className="mt-4 flex items-center gap-4">
          <button
            type="submit"
            disabled={busy || !goal.trim()}
            className="rounded-md bg-cobalt px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-cobalt-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? 'Starting…' : 'Start'}
          </button>
          {error ? (
            <p role="alert" className="text-sm text-mismatch">
              {error}
            </p>
          ) : null}
        </div>
      </form>

      <section aria-label="Examples" className="mt-8">
        <p className="text-sm text-ink-subtle">For example:</p>
        <ul className="mt-3 space-y-2">
          {EXAMPLES.map((example) => (
            <li key={example}>
              <button
                type="button"
                onClick={() => setGoal(example)}
                className="text-left text-ink-muted underline decoration-line-strong underline-offset-4 transition-colors hover:text-ink"
              >
                “{example}”
              </button>
            </li>
          ))}
        </ul>
      </section>

      {tasks.length > 0 ? (
        <section aria-labelledby="tasks-heading" className="mt-16 border-t border-line pt-8">
          <h2
            id="tasks-heading"
            className="text-sm font-medium tracking-wide text-ink-subtle uppercase"
          >
            Your tasks
          </h2>
          <ul className="mt-4 divide-y divide-line">
            {tasks.map((task) => (
              <li key={task.id}>
                <Link
                  href={`/workspace/${task.id}`}
                  className="group -mx-2 flex items-baseline justify-between gap-4 rounded-md px-2 py-3 transition-colors hover:bg-sunken"
                >
                  <span className="text-ink group-hover:text-cobalt">{task.goal}</span>
                  <span className="shrink-0 text-sm text-ink-subtle">
                    {STATE_LABELS[task.state]}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
