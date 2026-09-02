'use client';

/**
 * The hero's live demo: a miniature task that is *not a
 * marketing animation*. One click mints the visitor a real workspace, creates
 * a real task, and runs the real pilot against it — and then, if they approve,
 * the real checker runs and (on the demo seed) catches the real mismatch.
 *
 * Everything shown here is the same HTTP the workspace screen speaks. When the
 * demo ends, the task exists in their workspace, ready to keep exploring.
 */

import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import type { PublicTask } from '@/lib/http/task-view';
import { streamPilot, type PilotStreamStep } from '@/features/workspace/pilot-stream';
import { dayLabel } from '@/features/workspace/humanize';

const GOAL = 'Change my reservation to Friday, keep the same room, and stay under $300.';

type Phase = 'idle' | 'working' | 'review' | 'committing' | 'caught' | 'done' | 'error';

export function HeroDemo() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [steps, setSteps] = useState<PilotStreamStep[]>([]);
  const [task, setTask] = useState<PublicTask | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const busyRef = useRef(false);

  const loadTask = useCallback(async (taskId: string): Promise<PublicTask | null> => {
    const response = await fetch(`/api/tasks/${taskId}`);
    if (!response.ok) return null;
    const body = (await response.json()) as { task?: PublicTask };
    return body.task ?? null;
  }, []);

  const start = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setPhase('working');
    setSteps([]);
    setFailure(null);
    setTask(null);

    try {
      // A real workspace for this browser, then a real task in it.
      await fetch('/api/session');
      const created = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ goal: GOAL }),
      });
      const createdBody = (await created.json()) as { task?: PublicTask; error?: string };
      if (!created.ok || !createdBody.task) {
        setFailure(createdBody.error ?? 'the demo could not start');
        setPhase('error');
        return;
      }
      const taskId = createdBody.task.id;

      // The real pilot, streamed step by step.
      await streamPilot(taskId, (step) => setSteps((prev) => [...prev, step]));

      const current = await loadTask(taskId);
      setTask(current);
      if (current?.state === 'READY_FOR_REVIEW') setPhase('review');
      else if (current?.state === 'VERIFIED') setPhase('done');
      else if (current?.state === 'MISMATCH' || current?.state === 'ACCEPTED_WITH_EXCEPTIONS') {
        setPhase('caught');
      } else setPhase('review');
    } catch {
      setFailure('the connection dropped — nothing was changed');
      setPhase('error');
    } finally {
      busyRef.current = false;
    }
  }, [loadTask]);

  const approve = useCallback(async () => {
    if (!task || busyRef.current) return;
    busyRef.current = true;
    setPhase('committing');
    try {
      // The approval nonce exists only in this browser.
      const nonceResponse = await fetch(`/api/tasks/${task.id}/approve`);
      const nonceBody = (await nonceResponse.json()) as { nonce?: { id: string } | null };
      const nonceId = nonceBody.nonce?.id;
      if (!nonceId) {
        setFailure('the approval link was not ready — try again in a moment');
        setPhase('review');
        return;
      }

      const response = await fetch(`/api/tasks/${task.id}/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nonceId }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        setFailure(body.error ?? 'the approval did not go through');
        setPhase('review');
        return;
      }

      // The application commits and checks; the answer is the task itself.
      const current = await loadTask(task.id);
      setTask(current);
      setPhase(current?.verification?.matched ? 'done' : 'caught');
    } catch {
      setFailure('the connection dropped');
      setPhase('review');
    } finally {
      busyRef.current = false;
    }
  }, [task, loadTask]);

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
      <div className="border-b border-line bg-sunken/70 px-6 py-5">
        <p className="text-xs font-medium tracking-[0.18em] text-ink-subtle uppercase">
          Live — in a workspace made just for you
        </p>
        <p className="mt-2 font-display text-lg leading-snug text-ink">“{GOAL}”</p>
      </div>

      <div className="px-6 py-5" aria-live="polite">
        {phase === 'idle' ? (
          <div>
            <p className="text-sm text-ink-muted">
              This runs a real task through the real product — nothing is faked, nothing is
              prerecorded. When it says “done,” you’ll see what checking actually means.
            </p>
            <button
              type="button"
              onClick={() => void start()}
              className="mt-4 rounded-md bg-cobalt px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cobalt-hover"
            >
              Run this for me
            </button>
          </div>
        ) : null}

        {phase === 'working' || (phase === 'review' && steps.length > 0) ? (
          <ol className="space-y-1.5">
            {steps.map((step, index) => (
              <li key={index} className="flex items-baseline gap-2 text-sm">
                <span
                  aria-hidden="true"
                  className={
                    step.outcome === 'error'
                      ? 'text-mismatch'
                      : step.outcome === 'needs-you'
                        ? 'text-cobalt'
                        : 'text-verified'
                  }
                >
                  {step.outcome === 'error' ? '✕' : step.outcome === 'needs-you' ? '→' : '✓'}
                </span>
                <span className="text-ink-muted">{step.note}</span>
              </li>
            ))}
            {phase === 'working' ? (
              <li className="flex items-baseline gap-2 text-sm">
                <span aria-hidden="true" className="text-cobalt">
                  ·
                </span>
                <span className="text-ink-subtle">working…</span>
              </li>
            ) : null}
          </ol>
        ) : null}

        {phase === 'review' && task?.staged ? (
          <ReviewCard task={task} busy={false} onApprove={() => void approve()} />
        ) : null}

        {phase === 'committing' ? (
          <p className="text-sm text-ink-muted">
            You approved this. Proof is making the change — and then checking what the site
            actually did.
          </p>
        ) : null}

        {phase === 'caught' && task?.verification ? (
          <CaughtCard task={task} />
        ) : null}

        {phase === 'done' && task?.verification ? (
          <div>
            <p className="font-display text-xl text-verified">Done. And checked.</p>
            <p className="mt-2 text-sm text-ink-muted">
              Every condition held — the dates, the room, the price. That’s what “done” means
              here.
            </p>
            <TaskLink task={task} />
          </div>
        ) : null}

        {phase === 'error' ? (
          <div>
            <p className="text-sm text-mismatch">{failure ?? 'something went wrong'}</p>
            <button
              type="button"
              onClick={() => void start()}
              className="mt-3 rounded-md border border-line px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-sunken"
            >
              Try again
            </button>
          </div>
        ) : null}

        {failure && phase !== 'error' ? (
          <p role="alert" className="mt-3 text-sm text-mismatch">
            {failure}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ReviewCard({
  task,
  busy,
  onApprove,
}: {
  task: PublicTask;
  busy: boolean;
  onApprove: () => void;
}) {
  const staged = task.staged!;
  return (
    <div>
      <div className="mt-2 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">Before</p>
          <p className="mt-1 text-sm text-ink">
            {dayLabel(staged.before.checkIn)} · Room {staged.before.roomId} · $
            {staged.before.totalPrice}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">After</p>
          <p className="mt-1 text-sm text-ink">
            {dayLabel(staged.request.checkIn)} · Room {staged.request.roomId} · $
            {staged.quote.totalDollars}
            <span className="text-ink-subtle"> quoted</span>
          </p>
        </div>
      </div>
      <p className="mt-4 text-sm text-ink-muted">
        The agent stopped here on purpose. Approving is yours.
      </p>
      <button
        type="button"
        onClick={onApprove}
        disabled={busy}
        className="mt-3 rounded-md bg-cobalt px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cobalt-hover disabled:cursor-not-allowed disabled:opacity-40"
      >
        Make this change
      </button>
    </div>
  );
}

function CaughtCard({ task }: { task: PublicTask }) {
  const failed = task.verification!.verdicts.filter((v) => !v.satisfied);
  return (
    <div className="rounded-xl border border-mismatch-line bg-mismatch-soft/70 p-4">
      <p className="font-display text-xl text-mismatch">Checked — a difference was found.</p>
      <ul className="mt-2 space-y-1 text-sm text-ink-muted">
        {failed.map((verdict, index) => (
          <li key={index}>
            <span aria-hidden="true" className="mr-1.5 text-mismatch">
              ✕
            </span>
            {verdict.observed}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-ink">
        The price moved between the quote and the commit. <strong>Proof did not call this
        complete</strong> — the choice of what to do next stays with you.
      </p>
      <TaskLink task={task} />
    </div>
  );
}

function TaskLink({ task }: { task: PublicTask }) {
  return (
    <Link
      href={`/workspace/${task.id}`}
      className="mt-4 inline-block text-sm font-medium text-cobalt transition-colors hover:text-cobalt-hover"
    >
      Keep going with this task →
    </Link>
  );
}
