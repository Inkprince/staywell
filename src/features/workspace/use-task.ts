'use client';

/**
 * The task screen's connection to the server: current task + reservation +
 * audit trail, polled while anything can still change; the approval nonce,
 * polled only while something waits for review; and the human's decisions.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PublicTask } from '@/lib/http/task-view';
import type { ReservationSnapshot } from '@/lib/proof/constraints';
import type { AuditEvent } from '@/lib/proof/audit';
import type { RecoveryOption } from '@/lib/proof/recovery';
import { TERMINAL_STATES } from '@/lib/proof/state-machine';

export interface TaskBundle {
  task: PublicTask;
  reservation: ReservationSnapshot | null;
  events: AuditEvent[];
}

export type Decision = 'not_yet' | 'keep' | 'recover' | 'abandon';

export function useTask(taskId: string | null) {
  const [bundle, setBundle] = useState<TaskBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonceId, setNonceId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nonceRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!taskId) return;
    try {
      const response = await fetch(`/api/tasks/${taskId}`);
      const body = (await response.json()) as {
        task?: PublicTask;
        reservation?: ReservationSnapshot | null;
        error?: string;
      };
      if (!response.ok || !body.task) {
        setError(body.error ?? 'could not load this task');
        return;
      }
      setError(null);
      setBundle({
        task: body.task,
        reservation: body.reservation ?? null,
        events: bundle?.events ?? [],
      });
      if (response.ok) {
        const history = await fetch(`/api/tasks/${taskId}/history`);
        if (history.ok) {
          const h = (await history.json()) as { events?: AuditEvent[] };
          setBundle((current) =>
            current ? { ...current, events: h.events ?? current.events } : current,
          );
        }
      }
    } catch {
      // The next poll retries; the screen keeps what it has.
    }
    // `bundle` is intentionally not a dependency — this is a poll, and reading
    // the latest events through the setter avoids a stale closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  useEffect(() => {
    if (!taskId) return;
    setBundle(null);
    setNonceId(null);
    nonceRef.current = null;
    void refresh();
  }, [taskId, refresh]);

  // Poll while the task can still change; a terminal task settles for good.
  const state = bundle?.task.state;
  useEffect(() => {
    if (!state || TERMINAL_STATES.includes(state as never)) return;
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, [state, refresh]);

  // The approval channel: the one-time token exists only in this browser.
  const stagedId = bundle?.task.staged?.id ?? null;
  useEffect(() => {
    if (state !== 'READY_FOR_REVIEW' || !stagedId) {
      nonceRef.current = null;
      setNonceId(null);
      return;
    }

    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(`/api/tasks/${taskId}/approve`);
        if (!response.ok || cancelled) return;
        const body = (await response.json()) as { nonce: { id: string } | null };
        if (body.nonce && !cancelled) {
          nonceRef.current = body.nonce.id;
          setNonceId(body.nonce.id);
        }
      } catch {
        // Next poll will retry.
      }
    };

    void poll();
    const timer = setInterval(poll, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [taskId, state, stagedId]);

  /** The human's approval — the application then commits and checks. */
  const approve = useCallback(async (): Promise<boolean> => {
    if (!taskId || busy) return false;
    const token = nonceRef.current;
    if (!token) {
      setError('the approval link is not ready yet — one moment');
      return false;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/tasks/${taskId}/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nonceId: token }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? 'the approval did not go through');
        return false;
      }
      setError(null);
      await refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }, [taskId, busy, refresh]);

  /** The human's other decisions — none of which an agent can make. */
  const decide = useCallback(
    async (decision: Decision, optionId?: string): Promise<boolean> => {
      if (!taskId || busy) return false;
      setBusy(true);
      try {
        const response = await fetch(`/api/tasks/${taskId}/decide`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ decision, optionId }),
        });
        const body = (await response.json()) as { error?: string };
        if (!response.ok) {
          setError(body.error ?? 'that did not go through');
          return false;
        }
        setError(null);
        await refresh();
        return true;
      } finally {
        setBusy(false);
      }
    },
    [taskId, busy, refresh],
  );

  /** The recovery menu, computed fresh whenever the screen needs it. */
  const loadRecoveryOptions = useCallback(async (): Promise<RecoveryOption[]> => {
    if (!taskId) return [];
    const response = await fetch(`/api/tasks/${taskId}/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ step: 'find_recovery_options' }),
    });
    if (!response.ok) return [];
    const body = (await response.json()) as { options?: RecoveryOption[] };
    return body.options ?? [];
  }, [taskId]);

  return { bundle, error, busy, nonceId, refresh, approve, decide, loadRecoveryOptions };
}
