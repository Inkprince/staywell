'use client';

/**
 * The workspace, minimal for now (Phase 7 builds the full product here).
 *
 * What this page already does correctly — and what makes the WebMCP loop
 * *live* in the app, not just in tests:
 *
 * - mints/reuses the anonymous workspace via /api/session
 * - lets a person start a task in their own words
 * - derives the tool set from the live task state and registers it, so an
 *   agent on this page sees exactly what the task's state permits
 * - polls the approval channel while a change awaits review (the nonce
 *   delivery path; Phase 7 replaces polling with realtime + SSE fallback)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { toolsForTask } from '@/webmcp/tools';
import { useWebMCP, useWebMCPTools } from '@/webmcp/use-webmcp';

interface TaskView {
  id: string;
  goal: string;
  state: string;
  revision: number;
  constraints: unknown[];
  staged: {
    id: string;
    request: { reservationId: string; roomId: string; checkIn: string; nights: number };
    quote: { totalDollars: number; tierLabel: string; occupancy: number };
    rationale: string | null;
  } | null;
  verification: {
    matched: boolean;
    verdicts: { expected: string; observed: string; satisfied: boolean }[];
    unexpectedChanges: { field: string; before: unknown; after: unknown }[];
  } | null;
  approved: boolean;
}

export default function WorkspacePage() {
  const [tasks, setTasks] = useState<TaskView[]>([]);
  const [goal, setGoal] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { mode, registered } = useWebMCP();
  const approvalNonceRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/tasks');
      if (!response.ok) {
        // No session yet — mint one, then retry.
        await fetch('/api/session');
        const retry = await fetch('/api/tasks');
        if (!retry.ok) return;
        setTasks(((await retry.json()) as { tasks: TaskView[] }).tasks);
        return;
      }
      setTasks(((await response.json()) as { tasks: TaskView[] }).tasks);
    } catch {
      // The page still works offline for reading what is already loaded.
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selected = useMemo(
    () => tasks.find((t) => t.id === selectedId) ?? tasks[0] ?? null,
    [tasks, selectedId],
  );

  // The agent surface, derived from the live task state.
  const tools = useMemo(
    () =>
      toolsForTask({
        taskId: selected?.id ?? null,
        state: selected?.state ?? 'NEW',
      }),
    [selected?.id, selected?.state],
  );
  useWebMCPTools(tools);

  // Poll the approval channel while something awaits review. The nonce that
  // comes back is the only key that can release the change — and it exists
  // only in this browser, never in a tool response.
  useEffect(() => {
    if (!selected || selected.state !== 'READY_FOR_REVIEW' || !selected.staged) {
      approvalNonceRef.current = null;
      return;
    }

    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(`/api/tasks/${selected.id}/approve`);
        if (!response.ok || cancelled) return;
        const body = (await response.json()) as { nonce: { id: string } | null };
        if (body.nonce && !cancelled) approvalNonceRef.current = body.nonce.id;
      } catch {
        // Next poll will retry.
      }
    };

    void poll();
    const timer = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [selected?.id, selected?.state, selected?.staged]);

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
        const body = (await response.json()) as { task?: TaskView; error?: string };
        if (!response.ok || !body.task) {
          setError(body.error ?? 'could not start that task');
          return;
        }
        setGoal('');
        setSelectedId(body.task.id);
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [busy, refresh],
  );

  const approveStaged = useCallback(async () => {
    if (!selected || busy) return;
    const nonceId = approvalNonceRef.current;
    if (!nonceId) {
      setError('the approval link is not ready yet — one moment');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/tasks/${selected.id}/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nonceId }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? 'the approval did not go through');
        return;
      }
      approvalNonceRef.current = null;
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [selected, busy, refresh]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <Link
        href="/"
        className="text-sm text-ink-muted underline decoration-line-strong underline-offset-4 hover:text-ink"
      >
        Proof
      </Link>

      <h1 className="mt-8 font-display text-4xl leading-tight tracking-tight text-ink">
        What would you like done?
      </h1>
      <p className="mt-3 max-w-xl text-ink-muted">
        Say it in your words. An agent can work on it from here — and nothing is
        called complete until the site itself has checked the result.
      </p>

      <form
        className="mt-8"
        onSubmit={(event) => {
          event.preventDefault();
          void startTask(goal);
        }}
      >
        <label htmlFor="goal" className="sr-only">
          What would you like done?
        </label>
        <textarea
          id="goal"
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          rows={2}
          placeholder="Move my reservation to Friday, keep the same room, and stay under $300"
          className="w-full rounded-lg border border-line bg-surface px-4 py-3 text-ink placeholder:text-ink-subtle focus:border-cobalt focus:outline-none"
        />
        <div className="mt-3 flex items-center gap-3">
          <button
            type="submit"
            disabled={busy || !goal.trim()}
            className="rounded-md bg-cobalt px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cobalt-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? 'Starting…' : 'Start'}
          </button>
          {error ? <p className="text-sm text-mismatch">{error}</p> : null}
        </div>
      </form>

      <p className="mt-4 text-xs text-ink-subtle" role="status">
        {mode === 'unavailable'
          ? 'No agent connection in this browser — you can still work here yourself.'
          : `Agent surface: ${registered.length} tool${registered.length === 1 ? '' : 's'} on this page.`}
      </p>

      {tasks.length > 0 ? (
        <section aria-labelledby="tasks-heading" className="mt-12">
          <h2
            id="tasks-heading"
            className="text-sm font-medium tracking-wide text-ink-subtle uppercase"
          >
            Your tasks
          </h2>
          <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface">
            {tasks.map((task) => (
              <li key={task.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(task.id)}
                  className={`w-full p-4 text-left ${
                    selected?.id === task.id ? 'bg-sunken' : 'hover:bg-sunken/60'
                  }`}
                >
                  <p className="text-ink">{task.goal}</p>
                  <p className="mt-1 text-sm text-ink-subtle">
                    {task.state.replaceAll('_', ' ').toLowerCase()}
                    {task.verification
                      ? task.verification.matched
                        ? ' · done, and checked'
                        : ' · checked, something to review'
                      : ''}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {selected ? <TaskDetail task={selected} onApprove={approveStaged} busy={busy} /> : null}
    </main>
  );
}

function TaskDetail({ task, onApprove, busy }: { task: TaskView; onApprove: () => void; busy: boolean }) {
  return (
    <section aria-labelledby="task-heading" className="mt-12">
      <h2
        id="task-heading"
        className="text-sm font-medium tracking-wide text-ink-subtle uppercase"
      >
        {task.id}
      </h2>
      <p className="mt-2 text-lg text-ink">{task.goal}</p>

      <p className="mt-4 text-sm text-ink-muted">
        <span className="font-medium text-ink">
          {task.state.replaceAll('_', ' ').toLowerCase()}
        </span>
        {task.staged ? (
          <>
            {' — '}
            {task.staged.request.roomId}, {task.staged.request.nights} night
            {task.staged.request.nights === 1 ? '' : 's'} from {task.staged.request.checkIn}, quoted $
            {task.staged.quote.totalDollars} ({task.staged.quote.tierLabel})
          </>
        ) : null}
      </p>

      {task.state === 'READY_FOR_REVIEW' && task.staged ? (
        <div className="mt-6 rounded-lg border border-line bg-surface p-6">
          <h3 className="font-medium text-ink">Ready for your review</h3>
          <p className="mt-1 text-sm text-ink-muted">
            {task.staged.rationale ?? 'A change is proposed and waiting.'}
          </p>
          <button
            type="button"
            onClick={onApprove}
            disabled={busy}
            className="mt-4 rounded-md bg-cobalt px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cobalt-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? 'Approving…' : 'Approve this change'}
          </button>
          <p className="mt-3 text-xs text-ink-subtle">
            The change is applied only after you approve it — and the site then
            checks the result itself.
          </p>
        </div>
      ) : null}

      {task.verification ? (
        <div
          className={`mt-6 rounded-lg border p-6 ${
            task.verification.matched
              ? 'border-verified/40 bg-verified/5'
              : 'border-mismatch/40 bg-mismatch/5'
          }`}
          role="status"
        >
          <h3 className="font-medium text-ink">
            {task.verification.matched ? 'Done. And checked.' : 'We caught a mismatch.'}
          </h3>
          <ul className="mt-3 space-y-1 text-sm">
            {task.verification.verdicts.map((verdict, index) => (
              <li key={index} className="flex items-baseline gap-2">
                <span
                  aria-hidden="true"
                  className={verdict.satisfied ? 'text-verified' : 'text-mismatch'}
                >
                  {verdict.satisfied ? '✓' : '✕'}
                </span>
                <span className="text-ink-muted">
                  <span className="sr-only">{verdict.satisfied ? 'met: ' : 'not met: '}</span>
                  {verdict.expected} — {verdict.observed}
                </span>
              </li>
            ))}
          </ul>
          {task.verification.unexpectedChanges.length > 0 ? (
            <p className="mt-3 text-sm text-ink-muted">
              Something also changed that nobody asked for:{' '}
              {task.verification.unexpectedChanges
                .map((change) => `${change.field}: ${String(change.before)} → ${String(change.after)}`)
                .join('; ')}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
