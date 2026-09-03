'use client';

/**
 * The Proof chat — one component, two homes.
 *
 * The launcher overlay puts it on every page of the site; the hero embeds it
 * so the homepage demonstrates the product instead of describing it. Either
 * way it is the same real loop, told as a conversation: you say what you want
 * true about your stay, the pilot agent (server-side, no special privileges,
 * over the same HTTP the WebMCP tools speak) works through it in the open,
 * and at every decision point Proof answers with buttons — because the yes,
 * the no, and the "what now" are yours, not the agent's. A caught mismatch is
 * not a hand-off to another screen: the ways forward — keep it, undo it, or
 * another room — arrive as buttons in this same thread.
 *
 * Visually it is a dark-glass panel in the Glamour mold: frosted surface,
 * hairline white borders, a white pill carrying the one decisive action.
 * The scoped `dark` class flips the design tokens inside, so status colours
 * stay semantic rather than hand-mixed.
 *
 * Nothing here can approve on your behalf: the approval nonce exists only in
 * this browser, minted only for a task waiting on your decision.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { ArrowUp, ArrowUpRight, Check, Sparkles, X } from 'lucide-react';
import { motion } from 'motion/react';
import type { PublicTask } from '@/lib/http/task-view';
import type { RecoveryOption } from '@/lib/proof/recovery';
import { streamPilot, type PilotStreamStep } from '@/features/workspace/pilot-stream';
import { dayLabel } from '@/features/workspace/humanize';

const SUGGESTIONS = [
  'Move my stay to Friday for two nights, under $300',
  'Find me a quieter room for the same dates',
  'Make it one night shorter',
];

const GREETING =
  "Hi — I'm Proof, your agent for this stay. Ask for any change in your own words: I'll prepare it, you approve it, and StayWell checks the result before anyone calls it done.";

type SessionReservation = {
  id: string;
  roomId: string;
  checkIn: string;
  nights: number;
  totalDollars: number;
};

/** One line of the conversation. Decisions are entries too — with buttons. */
type Entry =
  | { id: number; kind: 'user'; text: string }
  | { id: number; kind: 'proof'; text: string }
  | { id: number; kind: 'work'; steps: PilotStreamStep[]; mode: 'working' | 'committing' }
  | { id: number; kind: 'review'; task: PublicTask; title?: string; decided?: 'yes' | 'no' }
  | { id: number; kind: 'options'; taskId: string; options: RecoveryOption[]; chosen?: string }
  | { id: number; kind: 'result'; task: PublicTask }
  | { id: number; kind: 'error'; text: string; retry?: string };

export function ProofConsole({
  defaultGoal = '',
  onClose,
}: {
  defaultGoal?: string;
  onClose?: () => void;
}) {
  const [entries, setEntries] = useState<Entry[]>(() => [
    { id: 0, kind: 'proof', text: GREETING },
  ]);
  const [draft, setDraft] = useState(defaultGoal);
  const [reservation, setReservation] = useState<SessionReservation | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const idRef = useRef(1);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Whose stay are we working on? The demo session always has one.
  useEffect(() => {
    let cancelled = false;
    void fetch('/api/session')
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { reservation?: SessionReservation | null } | null) => {
        if (!cancelled) setReservation(body?.reservation ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // A chat keeps its place: every new line brings the bottom into view.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [entries]);

  const append = useCallback((...added: Entry[]) => {
    setEntries((prev) => [...prev, ...added]);
  }, []);

  const loadTask = useCallback(async (taskId: string): Promise<PublicTask | null> => {
    const response = await fetch(`/api/tasks/${taskId}`);
    if (!response.ok) return null;
    const body = (await response.json()) as { task?: PublicTask };
    return body.task ?? null;
  }, []);

  /** The recovery menu after a caught mismatch — the same call the task screen makes. */
  const loadRecoveryOptions = useCallback(async (taskId: string): Promise<RecoveryOption[]> => {
    try {
      const response = await fetch(`/api/tasks/${taskId}/actions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ step: 'find_recovery_options' }),
      });
      if (!response.ok) return [];
      const body = (await response.json()) as { options?: RecoveryOption[] };
      return body.options ?? [];
    } catch {
      return [];
    }
  }, []);

  const send = useCallback(
    async (text: string) => {
      const ask = text.trim();
      if (!ask || !reservation || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setDraft('');

      const workId = idRef.current++;
      append(
        { id: idRef.current++, kind: 'user', text: ask },
        { id: workId, kind: 'work', steps: [], mode: 'working' },
      );

      try {
        const created = await fetch('/api/tasks', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reservationId: reservation.id, goal: ask }),
        });
        const createdBody = (await created.json()) as { task?: PublicTask; error?: string };
        if (!created.ok || !createdBody.task) {
          append({ id: idRef.current++, kind: 'error', text: createdBody.error ?? 'I could not start that request', retry: ask });
          return;
        }

        await streamPilot(createdBody.task.id, (step) => {
          setEntries((prev) =>
            prev.map((entry) =>
              entry.id === workId && entry.kind === 'work'
                ? { ...entry, steps: [...entry.steps, step] }
                : entry,
            ),
          );
        });

        const current = await loadTask(createdBody.task.id);
        if (current?.state === 'READY_FOR_REVIEW' && current.staged) {
          append({ id: idRef.current++, kind: 'review', task: current });
        } else if (
          current &&
          (current.state === 'VERIFIED' || current.state === 'MISMATCH' || current.state === 'ACCEPTED_WITH_EXCEPTIONS')
        ) {
          append({ id: idRef.current++, kind: 'result', task: current });
        } else {
          append({
            id: idRef.current++,
            kind: 'proof',
            text: 'I stopped here — nothing has been changed. Try asking another way?',
          });
        }
      } catch {
        append({
          id: idRef.current++,
          kind: 'error',
          text: 'The connection dropped — nothing was changed.',
          retry: ask,
        });
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [append, loadTask, reservation],
  );

  const approve = useCallback(
    async (entryId: number) => {
      const entry = entries.find((e) => e.id === entryId);
      if (!entry || entry.kind !== 'review' || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setEntries((prev) =>
        prev.map((e) => (e.id === entryId && e.kind === 'review' ? { ...e, decided: 'yes' } : e)),
      );
      append({ id: idRef.current++, kind: 'work', steps: [], mode: 'committing' });

      try {
        // The approval nonce exists only in this browser.
        const nonceResponse = await fetch(`/api/tasks/${entry.task.id}/approve`);
        const nonceBody = (await nonceResponse.json()) as { nonce?: { id: string } | null };
        const nonceId = nonceBody.nonce?.id;
        if (!nonceId) {
          setEntries((prev) =>
            prev.map((e) => (e.id === entryId && e.kind === 'review' ? { ...e, decided: undefined } : e)),
          );
          append({ id: idRef.current++, kind: 'error', text: 'The approval link was not ready — nothing was changed. Try again in a moment.' });
          return;
        }

        const response = await fetch(`/api/tasks/${entry.task.id}/approve`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ nonceId }),
        });
        if (!response.ok) {
          const body = (await response.json()) as { error?: string };
          setEntries((prev) =>
            prev.map((e) => (e.id === entryId && e.kind === 'review' ? { ...e, decided: undefined } : e)),
          );
          append({ id: idRef.current++, kind: 'error', text: body.error ?? 'The approval did not go through — nothing was changed.' });
          return;
        }

        const current = await loadTask(entry.task.id);
        if (current) {
          append({ id: idRef.current++, kind: 'result', task: current });
          // A caught mismatch is not a dead end, and not a hand-off either:
          // the ways forward arrive here, as buttons.
          if (current.state === 'MISMATCH' && current.verification && !current.verification.matched) {
            const options = await loadRecoveryOptions(current.id);
            if (options.length > 0) {
              append({ id: idRef.current++, kind: 'options', taskId: current.id, options });
            } else {
              append({
                id: idRef.current++,
                kind: 'proof',
                text: 'I could not load the ways forward just now — ask me again in a moment.',
              });
            }
          }
        }
      } catch {
        setEntries((prev) =>
          prev.map((e) => (e.id === entryId && e.kind === 'review' ? { ...e, decided: undefined } : e)),
        );
        append({ id: idRef.current++, kind: 'error', text: 'The connection dropped — nothing was changed without you.' });
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [append, entries, loadTask],
  );

  const decline = useCallback(
    (entryId: number) => {
      const entry = entries.find((e) => e.id === entryId);
      setEntries((prev) =>
        prev.map((e) => (e.id === entryId && e.kind === 'review' ? { ...e, decided: 'no' } : e)),
      );
      append({
        id: idRef.current++,
        kind: 'proof',
        text: 'No problem — nothing was changed. Ask me anything else.',
      });
      if (entry?.kind === 'review') {
        // Tell the server too: the staged change goes back to the drawing board.
        void fetch(`/api/tasks/${entry.task.id}/decide`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ decision: 'not_yet' }),
        }).catch(() => {});
      }
    },
    [append, entries],
  );

  /**
   * A recovery choice — the one place the chat decides *with* you. Keep ends
   * the task honestly as kept-with-a-difference; undo and another room stage a
   * fresh change that waits for your approval like any other.
   */
  const chooseRecovery = useCallback(
    async (entryId: number, option: RecoveryOption) => {
      const entry = entries.find((e) => e.id === entryId);
      if (!entry || entry.kind !== 'options' || entry.chosen || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setEntries((prev) =>
        prev.map((e) => (e.id === entryId && e.kind === 'options' ? { ...e, chosen: option.id } : e)),
      );

      const unchoose = () =>
        setEntries((prev) =>
          prev.map((e) => (e.id === entryId && e.kind === 'options' ? { ...e, chosen: undefined } : e)),
        );

      try {
        const decision =
          option.kind === 'keep_change'
            ? { decision: 'keep' as const }
            : { decision: 'recover' as const, optionId: option.id };
        const response = await fetch(`/api/tasks/${entry.taskId}/decide`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(decision),
        });
        const body = (await response.json()) as { task?: PublicTask; error?: string };
        if (
          !response.ok ||
          !body.task ||
          (option.kind !== 'keep_change' && !body.task.staged)
        ) {
          unchoose();
          append({ id: idRef.current++, kind: 'error', text: body.error ?? 'That did not go through — nothing was changed.' });
          return;
        }

        if (option.kind === 'keep_change') {
          append({ id: idRef.current++, kind: 'result', task: body.task });
          return;
        }

        const title =
          option.kind === 'undo'
            ? 'The way back, staged for you.'
            : `Room ${body.task.staged!.request.roomId}, staged for you.`;
        append({ id: idRef.current++, kind: 'review', task: body.task, title });
      } catch {
        unchoose();
        append({ id: idRef.current++, kind: 'error', text: 'The connection dropped — nothing was changed without you.' });
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [append, entries],
  );

  const awaitingDecision = entries.some((e) => e.kind === 'review' && !e.decided);
  const last = entries[entries.length - 1];
  const showSuggestions =
    !busy &&
    !awaitingDecision &&
    (entries.length <= 1 || last?.kind === 'result' || last?.kind === 'error');
  const composerLocked = busy || awaitingDecision || !reservation;

  const askAgain = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  /**
   * "Reset demo" — a fresh workspace at the canonical demo seed, so the
   * world's story (a $294 quote that becomes a $319 charge) is there to be
   * told again no matter how much has happened in this browser before.
   */
  const reset = useCallback(async () => {
    if (busyRef.current) return;
    try {
      const response = await fetch('/api/session', { method: 'POST' });
      if (!response.ok) return;
      const body = (await response.json()) as { reservation?: SessionReservation | null };
      setReservation(body.reservation ?? null);
      setEntries([
        { id: idRef.current++, kind: 'proof', text: GREETING },
      ]);
      setDraft(defaultGoal);
    } catch {
      // Keep the current workspace; the demo can continue as it is.
    }
  }, [defaultGoal]);

  return (
    <div className="dark flex h-full min-h-0 flex-col overflow-hidden rounded-[2rem] border border-white/12 bg-surface/80 text-white shadow-[0_40px_100px_-20px_rgba(0,0,0,0.55)] backdrop-blur-2xl">
      {/* Header — Proof's presence, with the ever-turning ring */}
      <div className="flex shrink-0 items-center gap-3.5 border-b border-white/10 px-5 py-4">
        <div className="relative size-11 shrink-0">
          <motion.span
            aria-hidden
            className="absolute inset-0 rounded-full border border-dashed border-white/25"
            animate={{ rotate: 360 }}
            transition={{ duration: 24, repeat: Infinity, ease: 'linear' }}
          />
          <span className="absolute inset-1.5 flex items-center justify-center rounded-full border border-white/15 bg-white/10 backdrop-blur-md">
            <Sparkles size={15} aria-hidden />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-[15px] font-medium tracking-tight text-white">Proof</p>
          <p className="truncate text-xs text-white/50">
            {reservation ? (
              <>
                Room {reservation.roomId} · {dayLabel(reservation.checkIn)} · $
                {reservation.totalDollars}
              </>
            ) : (
              'Reading your stay…'
            )}
          </p>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Proof"
            className="flex size-9 shrink-0 items-center justify-center rounded-full border border-white/15 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X size={15} aria-hidden />
          </button>
        ) : null}
      </div>

      {/* The conversation */}
      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5 [scrollbar-width:thin]"
      >
        {entries.map((entry) => (
          <motion.div
            key={entry.id}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: 'easeOut' }}
          >
            <EntryView
              entry={entry}
              onApprove={() => void approve(entry.id)}
              onDecline={() => decline(entry.id)}
              onRetry={() => void send(entry.kind === 'error' ? (entry.retry ?? '') : '')}
              onAskAgain={askAgain}
              onChooseRecovery={(option) => void chooseRecovery(entry.id, option)}
            />
          </motion.div>
        ))}

        {showSuggestions ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.15, ease: 'easeOut' }}
            className="flex flex-wrap gap-2 pt-1"
          >
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => void send(suggestion)}
                className="rounded-full border border-white/15 bg-white/[0.06] px-3.5 py-1.5 text-xs text-white/70 transition-colors hover:border-white/40 hover:text-white"
              >
                {suggestion}
              </button>
            ))}
          </motion.div>
        ) : null}
      </div>

      {/* Composer */}
      <form
        className="shrink-0 border-t border-white/10 bg-black/20 px-4 py-3.5"
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
      >
        <div className="flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] py-1.5 pl-5 pr-1.5 transition-colors focus-within:border-white/35">
          <input
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={400}
            placeholder={
              awaitingDecision
                ? 'Your decision is above — nothing changes without you'
                : reservation
                  ? 'Ask Proof to change your stay…'
                  : 'Reading your stay…'
            }
            disabled={composerLocked}
            className="w-full flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-white/40 disabled:opacity-60"
          />
          <button
            type="submit"
            aria-label="Send to Proof"
            disabled={composerLocked || !draft.trim()}
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white text-[#17181b] transition hover:scale-105 disabled:opacity-40 disabled:hover:scale-100"
          >
            <ArrowUp size={17} aria-hidden />
          </button>
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 px-2">
          <p className="text-[11px] text-white/35">
            Runs on the same tools any agent gets here — no special privileges.
          </p>
          <button
            type="button"
            onClick={() => void reset()}
            disabled={busy}
            className="shrink-0 text-[11px] text-white/35 underline decoration-white/20 underline-offset-2 transition-colors hover:text-white/75 disabled:opacity-40"
          >
            Reset demo
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One conversation line

function EntryView({
  entry,
  onApprove,
  onDecline,
  onRetry,
  onAskAgain,
  onChooseRecovery,
}: {
  entry: Entry;
  onApprove: () => void;
  onDecline: () => void;
  onRetry: () => void;
  onAskAgain: () => void;
  onChooseRecovery: (option: RecoveryOption) => void;
}) {
  switch (entry.kind) {
    case 'user':
      return (
        <div className="flex justify-end">
          <p className="max-w-[85%] rounded-[1.4rem] rounded-br-md bg-white px-4 py-3 text-[15px] font-medium leading-relaxed text-[#17181b] shadow-lg">
            {entry.text}
          </p>
        </div>
      );

    case 'proof':
      return (
        <p className="max-w-[88%] rounded-[1.4rem] rounded-tl-md border border-white/10 bg-white/[0.07] px-4 py-3 text-[15px] leading-relaxed text-white/90">
          {entry.text}
        </p>
      );

    case 'work':
      return <WorkEntry entry={entry} />;

    case 'review':
      return (
        <ReviewEntry entry={entry} onApprove={onApprove} onDecline={onDecline} />
      );

    case 'options':
      return <OptionsEntry entry={entry} onChoose={onChooseRecovery} />;

    case 'result':
      return <ResultEntry task={entry.task} onAskAgain={onAskAgain} />;

    case 'error':
      return (
        <div className="max-w-[88%] rounded-[1.4rem] rounded-tl-md border border-caution-line/60 bg-caution-soft/50 px-4 py-3">
          <p className="text-sm leading-relaxed text-white/85">{entry.text}</p>
          {entry.retry ? (
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 rounded-full border border-white/25 px-4 py-2 text-xs font-medium text-white/85 transition-colors hover:bg-white/10"
            >
              Try again
            </button>
          ) : null}
        </div>
      );
  }
}

// The agent at work — every step in the open, as it happens

function WorkEntry({ entry }: { entry: Extract<Entry, { kind: 'work' }> }) {
  const live = entry.mode === 'committing' ? 'Making the change — then checking what really happened' : 'working';
  return (
    <div className="max-w-[92%] rounded-[1.4rem] rounded-tl-md border border-white/10 bg-white/[0.04] px-4 py-3.5">
      <ol className="space-y-1.5 text-sm">
        {entry.steps.map((step, index) => (
          <li key={index} className="flex items-baseline gap-2.5">
            <StepGlyph outcome={step.outcome} />
            <span className="leading-relaxed text-white/75">{step.note}</span>
          </li>
        ))}
        <li className="flex items-baseline gap-2.5">
          <span aria-hidden className="text-cobalt">·</span>
          <span className="leading-relaxed text-white/50">{live}</span>
          <span className="flex gap-1 pb-0.5" aria-hidden>
            {[0, 1, 2].map((dot) => (
              <span
                key={dot}
                className="size-1 animate-pulse rounded-full bg-white/60"
                style={{ animationDelay: `${dot * 180}ms` }}
              />
            ))}
          </span>
        </li>
      </ol>
    </div>
  );
}

function StepGlyph({ outcome }: { outcome?: 'ok' | 'error' | 'needs-you' }) {
  if (outcome === 'error') return <X size={13} aria-hidden className="mt-0.5 shrink-0 text-mismatch" />;
  if (outcome === 'needs-you') return <ArrowUpRight size={13} aria-hidden className="mt-0.5 shrink-0 text-cobalt" />;
  return <Check size={13} aria-hidden className="mt-0.5 shrink-0 text-verified" />;
}

// The decision — exactly what changes, and the buttons that decide it

function ReviewEntry({
  entry,
  onApprove,
  onDecline,
}: {
  entry: Extract<Entry, { kind: 'review' }>;
  onApprove: () => void;
  onDecline: () => void;
}) {
  const staged = entry.task.staged!;
  return (
    <div className="max-w-[92%] rounded-[1.6rem] rounded-tl-md border border-white/12 bg-white/[0.07] p-5">
      <p className="font-display text-lg tracking-tight text-white">
        {entry.title ?? 'I found a way to do this. Your call.'}
      </p>
      {staged.rationale ? (
        <p className="mt-1.5 text-sm text-white/55 italic">&ldquo;{staged.rationale}&rdquo;</p>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-black/25 p-3.5">
          <p className="text-[10px] font-semibold tracking-[0.18em] text-white/45 uppercase">Now</p>
          <p className="mt-1.5 text-sm text-white/85">
            {dayLabel(staged.before.checkIn)} · Room {staged.before.roomId} · $
            {staged.before.totalPrice}
          </p>
        </div>
        <div className="rounded-2xl border border-cobalt-line/70 bg-cobalt-soft/50 p-3.5">
          <p className="text-[10px] font-semibold tracking-[0.18em] text-cobalt uppercase">
            If you say yes
          </p>
          <p className="mt-1.5 text-sm text-white">
            {dayLabel(staged.request.checkIn)} · Room {staged.request.roomId} · $
            {staged.quote.totalDollars}
            <span className="text-white/50"> quoted</span>
          </p>
        </div>
      </div>

      {entry.decided ? (
        <p className="mt-4 text-sm text-white/60">
          {entry.decided === 'yes' ? 'You approved this — see below.' : 'You set this aside — nothing changed.'}
        </p>
      ) : (
        <div className="mt-5 flex flex-wrap gap-3">
          <ActionPill onClick={onApprove}>Yes, make this change</ActionPill>
          <button
            type="button"
            onClick={onDecline}
            className="rounded-full border border-white/25 px-5 py-2.5 text-sm font-medium text-white/85 transition-colors hover:bg-white/10"
          >
            Never mind
          </button>
        </div>
      )}

      <p className="mt-3.5 text-xs leading-relaxed text-white/45">
        The price is a quote. After you approve, the site makes the change and then checks what it
        actually charged.
      </p>
    </div>
  );
}

// The checked result — the moment the product exists for

function ResultEntry({ task, onAskAgain }: { task: PublicTask; onAskAgain: () => void }) {
  const verification = task.verification;
  const workspaceLink = `/workspace/${task.id}` as Route;

  if (!verification) {
    return (
      <div className="max-w-[88%] rounded-[1.4rem] rounded-tl-md border border-white/10 bg-white/[0.07] px-4 py-3">
        <p className="text-sm leading-relaxed text-white/85">
          The change is in motion — the full story is on its task screen.
        </p>
        <GhostPill href={workspaceLink} className="mt-3">
          Open the task
        </GhostPill>
      </div>
    );
  }

  const failed = verification.verdicts.filter((v) => !v.satisfied);

  if (task.state === 'ACCEPTED_WITH_EXCEPTIONS') {
    return (
      <div className="max-w-[92%] rounded-[1.6rem] rounded-tl-md border border-caution-line/60 bg-caution-soft/50 p-5">
        <p className="font-display text-lg tracking-tight text-caution">
          Kept, with a difference.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-white/80">
          You chose to keep this result. What differs from your ask:{' '}
          {failed.map((v) => v.observed.toLowerCase()).join('; ')}.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <ActionPill onClick={onAskAgain}>Ask something else</ActionPill>
          <GhostPill href={workspaceLink}>See the full record</GhostPill>
        </div>
      </div>
    );
  }

  if (verification.matched) {
    return (
      <div className="max-w-[92%] rounded-[1.6rem] rounded-tl-md border border-verified-line/60 bg-verified-soft/50 p-5">
        <p className="font-display text-lg tracking-tight text-verified">Done — and I checked.</p>
        <p className="mt-2 text-sm leading-relaxed text-white/80">
          Every condition you set held: the dates, the room, the price. That&apos;s what
          &ldquo;done&rdquo; means here.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <ActionPill onClick={onAskAgain}>Ask something else</ActionPill>
          <GhostPill href={workspaceLink}>See the full record</GhostPill>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[92%] rounded-[1.6rem] rounded-tl-md border border-mismatch-line/70 bg-mismatch-soft/60 p-5">
      <p className="font-display text-lg tracking-tight text-mismatch">
        I checked — and caught a difference.
      </p>
      <ul className="mt-2.5 space-y-1.5 text-sm text-white/85">
        {failed.map((verdict, index) => (
          <li key={index} className="flex items-baseline gap-2">
            <X size={13} aria-hidden className="mt-0.5 shrink-0 text-mismatch" />
            <span>{verdict.observed}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm leading-relaxed text-white/90">
        I did <strong>not</strong> call this complete. What happens next is your choice — every
        way forward is right below.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <GhostPill onClick={onAskAgain}>Ask something else</GhostPill>
        <GhostPill href={workspaceLink}>Open the full record</GhostPill>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The ways forward, after a caught mismatch — buttons, not a detour

function OptionsEntry({
  entry,
  onChoose,
}: {
  entry: Extract<Entry, { kind: 'options' }>;
  onChoose: (option: RecoveryOption) => void;
}) {
  const keep = entry.options.find((o) => o.kind === 'keep_change');
  const undo = entry.options.find((o) => o.kind === 'undo');
  // Best-satisfying first, then cheapest — the same order the engine sorts.
  const alternates = entry.options.filter((o) => o.kind === 'alternate_room').slice(0, 5);
  const frozen = Boolean(entry.chosen);
  const chosen = entry.options.find((o) => o.id === entry.chosen);

  return (
    <div className="max-w-[95%] rounded-[1.6rem] rounded-tl-md border border-white/12 bg-white/[0.07] p-5">
      <p className="font-display text-lg tracking-tight text-white">What would you like to do?</p>

      {alternates.length > 0 ? (
        <div className="mt-4 space-y-2">
          {alternates.map((option) => (
            <ChoiceRow key={option.id} option={option} label="Prepare this" frozen={frozen} onChoose={onChoose} />
          ))}
        </div>
      ) : null}

      <div className="mt-2 space-y-2">
        {keep ? (
          <ChoiceRow option={keep} label="Keep it" frozen={frozen} onChoose={onChoose} strong />
        ) : null}
        {undo ? (
          <ChoiceRow option={undo} label="Put it back" frozen={frozen} onChoose={onChoose} />
        ) : null}
      </div>

      {frozen ? (
        <p className="mt-3 text-sm text-white/55">
          {chosen?.kind === 'keep_change'
            ? 'You kept the change — with the difference honestly noted.'
            : chosen?.kind === 'undo'
              ? 'You asked for the way back — one yes below.'
              : 'You asked for another room — one yes below.'}
        </p>
      ) : (
        <p className="mt-3.5 text-xs leading-relaxed text-white/45">
          Undoing and re-booking are changes too — they&apos;ll wait for your approval before
          anything moves.
        </p>
      )}
    </div>
  );
}

function ChoiceRow({
  option,
  label,
  frozen,
  strong,
  onChoose,
}: {
  option: RecoveryOption;
  label: string;
  frozen: boolean;
  strong?: boolean;
  onChoose: (option: RecoveryOption) => void;
}) {
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-3.5 ${
        strong ? 'border-caution-line/60 bg-caution-soft/30' : 'border-white/10 bg-black/25'
      }`}
    >
      <div className="min-w-0">
        <p className="text-sm font-medium leading-relaxed text-white">{option.summary}</p>
        <p
          className={`mt-1 text-xs ${
            option.violates.length > 0 ? 'text-mismatch' : 'text-verified'
          }`}
        >
          {option.violates.length > 0
            ? `Breaks ${option.violates.length} of your conditions`
            : 'Meets everything you asked'}
        </p>
      </div>
      <button
        type="button"
        disabled={frozen}
        onClick={() => onChoose(option)}
        className="shrink-0 rounded-full border border-white/25 px-4 py-2 text-xs font-medium text-white/85 transition-colors hover:bg-white/10 disabled:opacity-40"
      >
        {label}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The Glamour pill: white, decisive, with the arrow badge that turns on hover

function ActionPill({
  children,
  onClick,
  href,
  badge = true,
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  href?: Route;
  badge?: boolean;
  className?: string;
}) {
  const shape =
    'group inline-flex items-center overflow-hidden rounded-full bg-white py-2 pl-6 pr-2 text-sm font-semibold text-[#17181b] transition-all duration-300 hover:scale-[1.03]';
  const innards = (
    <>
      <span className="relative z-10">{children}</span>
      {badge ? (
        <span className="relative z-10 ml-3 rounded-full bg-[#17181b] p-1.5 text-white transition-colors duration-300 group-hover:bg-cobalt">
          <ArrowUpRight
            size={14}
            aria-hidden
            className="transition-transform duration-300 group-hover:rotate-45"
          />
        </span>
      ) : null}
    </>
  );
  if (href) {
    return (
      <Link href={href} onClick={onClick} className={`${shape} ${className}`}>
        {innards}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={`${shape} ${className}`}>
      {innards}
    </button>
  );
}

/** The quiet sibling: a ghost pill for second choices and record-keeping. */
function GhostPill({
  children,
  onClick,
  href,
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  href?: Route;
  className?: string;
}) {
  const shape =
    'inline-flex items-center rounded-full border border-white/25 px-5 py-2.5 text-sm font-medium text-white/85 transition-colors hover:bg-white/10';
  if (href) {
    return (
      <Link href={href} onClick={onClick} className={`${shape} ${className}`}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={`${shape} ${className}`}>
      {children}
    </button>
  );
}
