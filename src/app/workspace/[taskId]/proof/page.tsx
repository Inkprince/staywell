'use client';

/**
 * The proof receipt: the audit trail a person can read, and the
 * one place the product gently lets the machinery show.
 *
 * Your request, in your words. The final result, as the site holds it. When it
 * was checked, and what "checked" means — every constraint, expected against
 * observed, plus anything that changed that nobody asked for.
 */

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import type { PublicTask } from '@/lib/http/task-view';
import type { ReservationSnapshot } from '@/lib/proof/constraints';
import { dayLabel, fullTimestamp, shortConstraint } from '@/features/workspace/humanize';
import { StayWellNav } from '@/features/staywell/staywell-nav';

export default function ProofReceiptPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = use(params);
  const [task, setTask] = useState<PublicTask | null>(null);
  const [reservation, setReservation] = useState<ReservationSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHow, setShowHow] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/tasks/${taskId}`);
        const body = (await response.json()) as {
          task?: PublicTask;
          reservation?: ReservationSnapshot | null;
          error?: string;
        };
        if (cancelled) return;
        if (!response.ok || !body.task) {
          setError(body.error ?? 'could not load this task');
          return;
        }
        setTask(body.task);
        setReservation(body.reservation ?? null);
      } catch {
        if (!cancelled) setError('could not load this task');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  if (!task) {
    return (
      <main className="min-h-dvh bg-canvas"><StayWellNav />
        <div className="mx-auto max-w-2xl px-6 pt-36 pb-24">
          <p className="text-ink-muted">{error ?? 'Loading…'}</p>
          <Link href="/workspace" className="mt-4 inline-block text-cobalt hover:underline">
            Back to your workspace
          </Link>
        </div>
      </main>
    );
  }

  const verification = task.verification;
  const observed = reservation ?? task.staged?.before ?? null;
  const matched = verification?.matched ?? false;

  return (
    <main className="min-h-dvh bg-canvas"><StayWellNav />
      <div className="mx-auto max-w-2xl px-6 pt-32 pb-24 lg:pt-36">
        <Link
          href={`/workspace/${taskId}`}
          className="text-sm text-ink-subtle transition-colors hover:text-ink"
        >
          ← Back to the task
        </Link>

        <p className="mt-8 text-xs font-medium tracking-[0.22em] text-cobalt uppercase">The receipt</p>
        <h1 className="mt-4 font-display text-4xl leading-tight tracking-tight text-ink md:text-5xl">What actually happened</h1>

      <section className="mt-10 space-y-8">
        <div>
          <h2 className="text-xs font-medium tracking-[0.18em] text-ink-subtle uppercase">
            Your request
          </h2>
          <p className="mt-2 text-lg text-ink">“{task.goal}”</p>
        </div>

        <div>
          <h2 className="text-xs font-medium tracking-[0.18em] text-ink-subtle uppercase">
            Final result
          </h2>
          <p className="mt-2 text-lg text-ink">
            {observed
              ? `${dayLabel(observed.checkIn)} · Room ${observed.roomId} · $${observed.totalPrice}`
              : '—'}
          </p>
        </div>

        <div>
          <h2 className="text-xs font-medium tracking-[0.18em] text-ink-subtle uppercase">Checked</h2>
          <p className="mt-2 text-ink-muted">
            {verification ? fullTimestamp(verification.checkedAt) : 'Not yet checked'}
          </p>
        </div>

        <div
          className={`rounded-[2rem] border p-6 ${
            matched
              ? 'border-verified-line bg-verified-soft'
              : 'border-caution-line bg-caution-soft'
          }`}
          role="status"
        >
          <p className={`font-display text-2xl tracking-tight ${matched ? 'text-verified' : 'text-caution'}`}>
            {matched
              ? '✓ Everything matched'
              : task.state === 'ACCEPTED_WITH_EXCEPTIONS'
                ? 'Kept, with a difference'
                : 'A difference was found'}
          </p>
          {verification && !matched ? (
            <ul className="mt-3 space-y-1 text-sm text-ink-muted">
              {verification.verdicts
                .filter((v) => !v.satisfied)
                .map((verdict, index) => (
                  <li key={index}>
                    Expected {verdict.expected.toLowerCase()} — {verdict.observed.toLowerCase()}
                  </li>
                ))}
            </ul>
          ) : null}
        </div>

        {verification ? (
          <div className="border-t border-line pt-6">
            <button
              type="button"
              onClick={() => setShowHow((open) => !open)}
              aria-expanded={showHow}
              className="text-sm font-medium text-cobalt transition-colors hover:text-cobalt-hover"
            >
              {showHow ? 'Hide how we know' : 'How we know'}
            </button>
            {showHow ? (
              <ul className="mt-3 space-y-1.5 text-sm text-ink-muted">
                {verification.verdicts.map((verdict, index) => (
                  <li key={index} className="flex items-baseline gap-2">
                    <span
                      aria-hidden="true"
                      className={verdict.satisfied ? 'text-verified' : 'text-mismatch'}
                    >
                      {verdict.satisfied ? '✓' : '✕'}
                    </span>
                    <span>
                      {shortConstraint(verdict.constraint, task.staged?.before)} —{' '}
                      {verdict.observed}
                    </span>
                  </li>
                ))}
                {verification.unexpectedChanges.length > 0 ? (
                  <li className="text-mismatch">
                    Also changed, unasked:{' '}
                    {verification.unexpectedChanges
                      .map((c) => `${c.field}: ${String(c.before)} → ${String(c.after)}`)
                      .join('; ')}
                  </li>
                ) : (
                  <li className="text-verified">
                    Nothing else changed that nobody asked for.
                  </li>
                )}
                <li className="pt-2 text-ink-subtle">
                  Every check above was run by the site itself, against a fresh read of your
                  reservation, after the change was made. The record cannot be edited.
                </li>
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>
      </div>
    </main>
  );
}
