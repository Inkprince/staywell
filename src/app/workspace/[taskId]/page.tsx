'use client';

/**
 * The task screen — where the product's promise is either kept or caught.
 *
 * Layout: the four layers (Goal / Plan / Reality / Proof) are
 * always visible, the "What's happening" panel is calm and human, approval is
 * a decision a person makes on a card that shows exactly what changes, and a
 * caught mismatch is the moment the interface was designed around.
 *
 * The agent surface also lives here: the tool set is derived from the live
 * task state and registered with the browser, so an agent on this page can
 * work the task — and can never approve, commit, or declare success.
 */

import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { PublicTask } from '@/lib/http/task-view';
import type { ReservationSnapshot } from '@/lib/proof/constraints';
import type { RecoveryOption } from '@/lib/proof/recovery';
import { toolsForTask } from '@/webmcp/tools';
import { useWebMCPTools } from '@/webmcp/use-webmcp';
import { useTask } from '@/features/workspace/use-task';
import {
  STATE_LABELS,
  describeChange,
  dayLabel,
  fullTimestamp,
  humanizeEvent,
  shortConstraint,
  timeLabel,
} from '@/features/workspace/humanize';
import { Inspector } from '@/features/inspector/inspector';

export default function TaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ taskId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { taskId } = use(params);
  const { inspect } = use(searchParams);
  const { bundle, error, busy, approve, decide, loadRecoveryOptions } = useTask(taskId);
  const [inspectOpen, setInspectOpen] = useState(inspect === '1');
  const [showHappening, setShowHappening] = useState(false);

  const task = bundle?.task ?? null;
  const reservation = bundle?.reservation ?? null;

  // The agent surface, derived from the live task state.
  const tools = useMemo(
    () => toolsForTask({ taskId, state: task?.state ?? 'NEW' }),
    [taskId, task?.state],
  );
  useWebMCPTools(tools);

  const timeline = useMemo(() => {
    const entries = (bundle?.events ?? [])
      .map(humanizeEvent)
      .filter((entry): entry is { label: string; at: string } => entry !== null);
    return entries;
  }, [bundle?.events]);

  if (!task) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-20">
        <p className="text-ink-muted">{error ?? 'Loading…'}</p>
        <Link href="/workspace" className="mt-4 inline-block text-cobalt hover:underline">
          Back to your workspace
        </Link>
      </main>
    );
  }

  const staged = task.staged;

  return (
    <main className="mx-auto max-w-2xl px-6 py-12 pb-24">
      <div className="flex items-baseline justify-between">
        <Link href="/workspace" className="text-sm text-ink-subtle transition-colors hover:text-ink">
          ← Your workspace
        </Link>
        <p aria-live="polite" className="text-sm text-ink-subtle">
          {STATE_LABELS[task.state]}
        </p>
      </div>

      <h1 className="mt-6 font-display text-3xl leading-snug tracking-tight text-ink">
        {task.goal}
      </h1>

      <FourLayers task={task} reservation={reservation} />

      <section className="mt-10">
        <button
          type="button"
          onClick={() => setShowHappening((open) => !open)}
          aria-expanded={showHappening}
          className="text-sm font-medium text-cobalt transition-colors hover:text-cobalt-hover"
        >
          {showHappening ? 'Hide what’s happening' : 'What’s happening'}
        </button>
        {showHappening ? <WhatsHappening timeline={timeline} /> : null}
      </section>

      <div aria-live="polite">
        {error ? (
          <p role="alert" className="mt-6 rounded-lg bg-mismatch-soft px-4 py-3 text-sm text-mismatch">
            {error}
          </p>
        ) : null}

        {['NEW', 'UNDERSTANDING', 'PLANNING', 'REPLANNING'].includes(task.state) ? (
          <WorkingState task={task} />
        ) : null}

        {task.state === 'READY_FOR_REVIEW' && staged ? (
          <ApprovalCard
            task={task}
            busy={busy}
            onApprove={() => void approve()}
            onNotYet={() => void decide('not_yet')}
          />
        ) : null}

        {['APPROVED', 'EXECUTING', 'VERIFYING'].includes(task.state) ? (
          <section className="mt-10 rounded-xl border border-line bg-surface p-8 text-center">
            <p className="text-ink-muted">
              {task.state === 'VERIFYING' ? 'Checking the result…' : 'Making the change…'}
            </p>
            <p className="mt-2 text-sm text-ink-subtle">
              You approved this change. Proof is confirming what actually happened.
            </p>
          </section>
        ) : null}

        {['MISMATCH', 'RECOVERING'].includes(task.state) && task.verification ? (
          <MismatchScreen
            task={task}
            busy={busy}
            loadOptions={loadRecoveryOptions}
            onKeep={() => void decide('keep')}
            onChooseOption={(optionId) => void decide('recover', optionId)}
          />
        ) : null}

        {task.state === 'VERIFIED' && task.verification ? (
          <VerifiedState task={task} reservation={reservation} />
        ) : null}

        {task.state === 'ACCEPTED_WITH_EXCEPTIONS' && task.verification ? (
          <AcceptedState task={task} reservation={reservation} />
        ) : null}

        {task.state === 'ABANDONED' ? (
          <section className="mt-10 rounded-xl border border-line bg-surface p-8">
            <h2 className="font-display text-2xl text-ink">Set aside.</h2>
            <p className="mt-2 text-ink-muted">
              This task was closed without completing. Nothing was changed after your last
              decision.
            </p>
          </section>
        ) : null}
      </div>

      {timeline.length > 0 ? <Timeline timeline={timeline} /> : null}

      <button
        type="button"
        onClick={() => setInspectOpen(true)}
        className="fixed right-6 bottom-6 text-xs text-ink-subtle underline decoration-line-strong underline-offset-4 transition-colors hover:text-ink"
      >
        Inspect
      </button>

      {inspectOpen ? (
        <Inspector onClose={() => setInspectOpen(false)} task={task} events={bundle?.events ?? []} />
      ) : null}
    </main>
  );
}

// ---------------------------------------------------------------------------
// The four layers: Goal / Plan / Reality / Proof, always in view

function FourLayers({
  task,
  reservation,
}: {
  task: PublicTask;
  reservation: ReservationSnapshot | null;
}) {
  const before = task.staged?.before ?? null;
  return (
    <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
      <Layer title="Goal">
        {task.constraints.length > 0 ? (
          <ul className="space-y-1">
            {task.constraints.map((constraint, index) => (
              <li key={index}>{shortConstraint(constraint, before)}</li>
            ))}
          </ul>
        ) : (
          <span className="text-ink-subtle">In your words, above</span>
        )}
      </Layer>
      <Layer title="Plan">
        {task.staged ? (
          <span>
            {dayLabel(task.staged.request.checkIn)} · Room {task.staged.request.roomId} · $
            {task.staged.quote.totalDollars}
          </span>
        ) : (
          <span className="text-ink-subtle">Being worked out</span>
        )}
      </Layer>
      <Layer title="Reality">
        {reservation ? (
          <span>
            {dayLabel(reservation.checkIn)} · Room {reservation.roomId} · $
            {reservation.totalPrice}
          </span>
        ) : (
          <span className="text-ink-subtle">Reading the site…</span>
        )}
      </Layer>
      <Layer title="Proof">
        {task.verification ? (
          <span className={task.verification.matched ? 'text-verified' : 'text-mismatch'}>
            {task.verification.matched ? 'Everything matched' : 'A difference was found'}
          </span>
        ) : (
          <span className="text-ink-subtle">Not checked yet</span>
        )}
      </Layer>
    </dl>
  );
}

function Layer({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface p-4">
      <dt className="text-xs font-medium tracking-wide text-ink-subtle uppercase">{title}</dt>
      <dd className="mt-2 text-sm leading-relaxed text-ink">{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// What's happening: the progress panel, in human language

function WhatsHappening({ timeline }: { timeline: { label: string; at: string }[] }) {
  if (timeline.length === 0) {
    return <p className="mt-3 text-sm text-ink-subtle">Just getting started.</p>;
  }
  return (
    <ul className="mt-3 space-y-1.5" aria-live="polite">
      {timeline.map((entry, index) => {
        const isLatest = index === timeline.length - 1;
        return (
          <li key={`${entry.at}-${index}`} className="flex items-baseline gap-2 text-sm">
            <span aria-hidden="true" className={isLatest ? 'text-cobalt' : 'text-verified'}>
              {isLatest ? '→' : '✓'}
            </span>
            <span className={isLatest ? 'text-ink' : 'text-ink-muted'}>
              {entry.label}
              <span className="sr-only">{isLatest ? ' (in progress)' : ' (done)'}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function WorkingState({ task }: { task: PublicTask }) {
  return (
    <section className="mt-10 rounded-xl border border-line bg-surface p-8">
      <p className="text-ink-muted">
        {task.constraints.length === 0
          ? 'Proof is reading your request…'
          : 'Proof is working out the safest way to do this…'}
      </p>
      <p className="mt-2 text-sm text-ink-subtle">
        When a change is ready, it waits here for your decision. Nothing happens to your
        booking until you say so.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The approval card: the human's decision, beautifully framed

function ApprovalCard({
  task,
  busy,
  onApprove,
  onNotYet,
}: {
  task: PublicTask;
  busy: boolean;
  onApprove: () => void;
  onNotYet: () => void;
}) {
  const staged = task.staged!;
  const before = staged.before;
  const after = staged.request;

  const stays = [
    before.roomId === after.roomId ? `Room ${after.roomId}` : null,
    `${before.guestName} (guest)`,
    before.nights === after.nights ? `${after.nights} nights` : null,
  ].filter((line): line is string => line !== null);

  const changes = describeChange(before, { ...after, quote: staged.quote });

  return (
    <section
      aria-labelledby="approval-heading"
      className="mt-10 rounded-xl border border-cobalt-line bg-cobalt-soft/60 p-8"
    >
      <h2 id="approval-heading" className="font-display text-3xl text-ink">
        Ready to make this change?
      </h2>

      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <div>
          <h3 className="text-sm font-medium tracking-wide text-ink-subtle uppercase">Before</h3>
          <p className="mt-2 text-ink">
            {dayLabel(before.checkIn)}
            <br />
            Room {before.roomId}
            <br />${before.totalPrice}
          </p>
        </div>
        <div>
          <h3 className="text-sm font-medium tracking-wide text-ink-subtle uppercase">After</h3>
          <p className="mt-2 text-ink">
            {dayLabel(after.checkIn)}
            <br />
            Room {after.roomId}
            <br />${staged.quote.totalDollars}
            <span className="text-sm text-ink-subtle"> quoted</span>
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 border-t border-cobalt-line pt-6 sm:grid-cols-2">
        <div>
          <h3 className="text-sm font-medium tracking-wide text-ink-subtle uppercase">
            What stays the same
          </h3>
          <ul className="mt-2 space-y-1 text-sm text-ink-muted">
            {stays.map((line) => (
              <li key={line}>
                <span aria-hidden="true" className="mr-1.5 text-verified">
                  ✓
                </span>
                {line}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-medium tracking-wide text-ink-subtle uppercase">
            What changes
          </h3>
          <ul className="mt-2 space-y-1 text-sm text-ink-muted">
            {changes.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      </div>

      {staged.rationale ? (
        <p className="mt-6 text-sm text-ink-muted">“{staged.rationale}”</p>
      ) : null}

      <div className="mt-8 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={onApprove}
          disabled={busy}
          className="rounded-md bg-cobalt px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-cobalt-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? 'Making the change…' : 'Make this change'}
        </button>
        <button
          type="button"
          onClick={onNotYet}
          disabled={busy}
          className="rounded-md border border-line px-6 py-3 text-sm font-medium text-ink transition-colors hover:bg-sunken disabled:cursor-not-allowed disabled:opacity-40"
        >
          Not yet
        </button>
      </div>
      <p className="mt-4 text-xs text-ink-subtle">
        The price shown is a quote. After you approve, Proof makes the change and then checks
        what the site actually charged.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The mismatch screen — the product's defining moment

function MismatchScreen({
  task,
  busy,
  loadOptions,
  onKeep,
  onChooseOption,
}: {
  task: PublicTask;
  busy: boolean;
  loadOptions: () => Promise<RecoveryOption[]>;
  onKeep: () => void;
  onChooseOption: (optionId: string) => void;
}) {
  const [options, setOptions] = useState<RecoveryOption[] | null>(null);
  const [showAlternates, setShowAlternates] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadOptions().then((loaded) => {
      if (!cancelled) setOptions(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [loadOptions, task.state, task.revision]);

  const verification = task.verification!;
  const failed = verification.verdicts.filter((v) => !v.satisfied);
  const keepOption = options?.find((o) => o.kind === 'keep_change');
  const undoOption = options?.find((o) => o.kind === 'undo');
  const alternates = options?.filter((o) => o.kind === 'alternate_room') ?? [];

  return (
    <section aria-labelledby="mismatch-heading" className="mt-10">
      <div className="rounded-xl border border-mismatch-line bg-mismatch-soft p-8">
        <h2 id="mismatch-heading" className="font-display text-3xl text-ink">
          We caught a mismatch.
        </h2>

        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <div>
            <h3 className="text-sm font-medium tracking-wide text-ink-subtle uppercase">
              You asked for
            </h3>
            <ul className="mt-2 space-y-1 text-ink">
              {verification.verdicts.map((verdict, index) => (
                <li key={index}>{shortConstraint(verdict.constraint, task.staged?.before)}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-medium tracking-wide text-ink-subtle uppercase">
              What actually happened
            </h3>
            <ul className="mt-2 space-y-1 text-ink">
              {verification.verdicts.map((verdict, index) => (
                <li key={index} className={verdict.satisfied ? 'text-ink' : 'text-mismatch'}>
                  <span aria-hidden="true" className="mr-1.5">
                    {verdict.satisfied ? '✓' : '✕'}
                  </span>
                  {verdict.observed}
                  <span className="sr-only">{verdict.satisfied ? ' (as asked)' : ' (not as asked)'}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <p className="mt-6 text-ink-muted">
          The change went through, but{' '}
          {failed.length === 1
            ? `${failed[0]!.observed.toLowerCase().replace('total is', 'the price is')}`
            : 'part of what you asked for did not hold'}
          . <strong className="text-ink">We haven’t called this complete.</strong>
        </p>
      </div>

      <div className="mt-8">
        <h3 className="text-lg font-medium text-ink">What would you like to do?</h3>

        <div className="mt-4 space-y-3">
          <RecoveryChoice
            title="Find another option"
            description={
              alternates.length > 0
                ? `I’ll look for another room that stays within your limits — ${alternates.length} are open on those nights.`
                : 'I’ll look for another way to stay within your limits.'
            }
            busy={busy}
            onClick={() => setShowAlternates((open) => !open)}
            expanded={showAlternates}
            alternates={alternates}
            onChooseAlternate={onChooseOption}
          />

          <RecoveryChoice
            title="Keep this change"
            description={keepOption?.summary ?? 'Keep the change and accept the new price.'}
            busy={busy}
            onClick={onKeep}
          />

          <RecoveryChoice
            title="Undo it"
            description={undoOption?.summary ?? 'Return to your previous reservation.'}
            busy={busy}
            onClick={() => undoOption && onChooseOption(undoOption.id)}
          />
        </div>

        <p className="mt-4 text-xs text-ink-subtle">
          Undoing and re-booking are changes too — they’ll wait for your approval before
          anything moves.
        </p>
      </div>
    </section>
  );
}

function RecoveryChoice({
  title,
  description,
  busy,
  onClick,
  expanded,
  alternates,
  onChooseAlternate,
}: {
  title: string;
  description: string;
  busy: boolean;
  onClick: () => void;
  expanded?: boolean;
  alternates?: RecoveryOption[];
  onChooseAlternate?: (optionId: string) => void;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="font-medium text-ink">{title}</p>
          <p className="mt-1 text-sm text-ink-muted">{description}</p>
        </div>
        {alternates ? (
          <button
            type="button"
            onClick={onClick}
            aria-expanded={expanded}
            className="rounded-md border border-line px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-sunken"
          >
            {expanded ? 'Hide rooms' : 'See rooms'}
          </button>
        ) : (
          <button
            type="button"
            onClick={onClick}
            disabled={busy}
            className="rounded-md border border-line px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-sunken disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? 'Working…' : 'Choose'}
          </button>
        )}
      </div>

      {expanded && alternates ? (
        <ul className="mt-4 space-y-2 border-t border-line pt-4">
          {alternates.slice(0, 5).map((option) => (
            <li
              key={option.id}
              className="flex flex-wrap items-baseline justify-between gap-3 text-sm"
            >
              <span className="text-ink">
                {option.summary}
                {option.violates.length > 0 ? (
                  <span className="text-mismatch">
                    {' '}
                    — breaks {option.violates.length} of your conditions
                  </span>
                ) : (
                  <span className="text-verified"> — meets everything you asked</span>
                )}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => onChooseAlternate?.(option.id)}
                className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-sunken disabled:cursor-not-allowed disabled:opacity-40"
              >
                Prepare this
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The final states

function VerifiedState({
  task,
  reservation,
}: {
  task: PublicTask;
  reservation: ReservationSnapshot | null;
}) {
  const observed = reservation ?? task.staged?.before ?? null;
  return (
    <section className="mt-10 rounded-xl border border-verified-line bg-verified-soft p-8">
      <h2 className="font-display text-4xl text-ink">Done. And checked.</h2>
      {observed ? (
        <p className="mt-4 text-lg text-ink">
          {dayLabel(observed.checkIn)} · Room {observed.roomId} · ${observed.totalPrice}
        </p>
      ) : null}
      <p className="mt-2 text-ink-muted">Everything you asked for is now true.</p>
      <p className="mt-6 text-sm text-ink-subtle">
        Verified {task.verification ? fullTimestamp(task.verification.checkedAt) : 'just now'}
      </p>
      <Link
        href={`/workspace/${task.id}/proof`}
        className="mt-6 inline-block rounded-md bg-cobalt px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-cobalt-hover"
      >
        View proof
      </Link>
    </section>
  );
}

function AcceptedState({
  task,
  reservation,
}: {
  task: PublicTask;
  reservation: ReservationSnapshot | null;
}) {
  const failed = task.verification!.verdicts.filter((v) => !v.satisfied);
  return (
    <section className="mt-10 rounded-xl border border-caution-line bg-caution-soft p-8">
      <h2 className="font-display text-3xl text-ink">Kept, with a difference.</h2>
      <p className="mt-3 text-ink-muted">
        You chose to keep this result.{' '}
        {failed.length > 0
          ? `What differs from your ask: ${failed.map((v) => v.observed.toLowerCase()).join('; ')}.`
          : ''}
      </p>
      {reservation ? (
        <p className="mt-4 text-ink">
          {dayLabel(reservation.checkIn)} · Room {reservation.roomId} · ${reservation.totalPrice}
        </p>
      ) : null}
      <Link
        href={`/workspace/${task.id}/proof`}
        className="mt-6 inline-block rounded-md border border-line px-6 py-3 text-sm font-medium text-ink transition-colors hover:bg-surface"
      >
        View the record
      </Link>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The timeline: human-readable, no tool names, no JSON, no ids

function Timeline({ timeline }: { timeline: { label: string; at: string }[] }) {
  return (
    <section aria-labelledby="timeline-heading" className="mt-14 border-t border-line pt-8">
      <h2
        id="timeline-heading"
        className="text-sm font-medium tracking-wide text-ink-subtle uppercase"
      >
        Timeline
      </h2>
      <ol className="mt-4 space-y-3">
        {timeline.map((entry, index) => (
          <li key={`${entry.at}-${index}`} className="flex gap-4">
            <span className="w-16 shrink-0 pt-0.5 text-sm tabular-nums text-ink-subtle">
              {timeLabel(entry.at)}
            </span>
            <span className="text-ink">{entry.label}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
