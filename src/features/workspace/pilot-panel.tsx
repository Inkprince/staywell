'use client';

/**
 * The built-in pilot, surfaced: "Have Proof's agent work on
 * this."
 *
 * The panel streams the pilot's steps as they happen — one line of NDJSON per
 * step — and shows them in the same calm voice as the rest of the screen. When
 * the run ends it refreshes the task, so whatever the pilot staged (or refused
 * to stage) appears in the interface immediately.
 *
 * The pilot stops at review every time; the panel says so rather than
 * pretending the work is done.
 */

import { useCallback, useRef, useState } from 'react';

interface StreamedStep {
  engine?: string;
  taskId?: string;
  note?: string;
  path?: string;
  outcome?: 'ok' | 'error' | 'needs-you';
}

export function PilotPanel({ taskId, onDone }: { taskId: string; onDone: () => void }) {
  const [steps, setSteps] = useState<StreamedStep[]>([]);
  const [engine, setEngine] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    setStarted(true);
    setRunning(true);
    setSteps([]);
    setEngine(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch('/api/pilot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ taskId }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        let why = `the pilot could not start (${response.status})`;
        try {
          const body = (await response.json()) as { error?: string };
          if (body.error) why = body.error;
        } catch {
          // keep the status-line message
        }
        setSteps([{ note: why, outcome: 'error' }]);
      } else {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const step = JSON.parse(line) as StreamedStep;
              if (!step.note) {
                // The opening line: which engine is running.
                if (step.engine) setEngine(step.engine);
                continue;
              }
              setSteps((prev) => [...prev, step]);
            } catch {
              // A partial line never reaches us — buffer holds it back.
            }
          }
        }
      }
    } catch {
      if (!controller.signal.aborted) {
        setSteps((prev) => [...prev, { note: 'The connection dropped. Nothing was changed.', outcome: 'error' }]);
      }
    } finally {
      setRunning(false);
      onDone();
    }
  }, [taskId, onDone]);

  return (
    <div className="mt-4 rounded-lg border border-line bg-sunken/60 p-5">
      {started ? (
        <ol className="space-y-1.5" aria-live="polite">
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
          {running ? (
            <li className="flex items-baseline gap-2 text-sm">
              <span aria-hidden="true" className="text-cobalt">
                ·
              </span>
              <span className="text-ink-subtle">working…</span>
            </li>
          ) : null}
        </ol>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void run()}
          disabled={running}
          className="rounded-md border border-line px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
        >
          {running ? 'Working…' : started ? 'Run it again' : 'Have Proof’s agent work on this'}
        </button>
        {running ? (
          <button
            type="button"
            onClick={() => abortRef.current?.abort()}
            className="text-xs text-ink-subtle underline decoration-line-strong underline-offset-4 transition-colors hover:text-ink"
          >
            Stop watching
          </button>
        ) : null}
        {engine && !running ? (
          <span className="text-xs text-ink-subtle">
            {engine === 'openai' ? 'Model-backed run' : 'Built-in playbook'}
          </span>
        ) : null}
      </div>

      <p className="mt-3 text-xs text-ink-subtle">
        The agent can plan and propose. Approving is yours — the button appears when a change
        is ready.
      </p>
    </div>
  );
}
