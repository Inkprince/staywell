'use client';

/**
 * The inspector: developer mode, deliberately unhidden.
 *
 * This is where the product shows it is not smoke and mirrors — the real tool
 * surface, the real state machine, the real calls, the real verdicts. The main
 * screens speak human; this one speaks machine, clearly labelled.
 */

import { useEffect, useState } from 'react';
import type { PublicTask } from '@/lib/http/task-view';
import type { AuditEvent } from '@/lib/proof/audit';
import { useWebMCP } from '@/webmcp/use-webmcp';

const TABS = ['Tools', 'State', 'Actions', 'Verification', 'Timeline'] as const;
type Tab = (typeof TABS)[number];

export function Inspector({
  task,
  events,
  onClose,
}: {
  task: PublicTask;
  events: readonly AuditEvent[];
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('Tools');
  const { mode, registered, calls } = useWebMCP();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Inspect this task">
      <button
        type="button"
        aria-label="Close inspector"
        onClick={onClose}
        className="absolute inset-0 bg-ink/20 backdrop-blur-[1px]"
      />
      <aside className="relative flex h-full w-full max-w-xl flex-col border-l border-line bg-surface shadow-2xl">
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="font-medium text-ink">Under the hood</h2>
            <p className="text-xs text-ink-subtle">
              {mode === 'unavailable'
                ? 'WebMCP not present in this browser — tools listed as the page would register them'
                : `WebMCP: ${mode}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-line px-3 py-1.5 text-sm text-ink transition-colors hover:bg-sunken"
          >
            Close
          </button>
        </header>

        <nav className="flex gap-1 overflow-x-auto border-b border-line px-3 py-2" aria-label="Inspector sections">
          {TABS.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setTab(name)}
              aria-current={tab === name}
              className={`rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition-colors ${
                tab === name ? 'bg-sunken font-medium text-ink' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {name}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'Tools' ? (
            <section>
              <p className="mb-3 text-sm text-ink-muted">
                The tool set this page registers for the task’s current state ({task.state}).
                Approving, committing, and declaring success are not tools — they don’t exist on
                this surface in any state.
              </p>
              {registered.length > 0 ? (
                <ul className="space-y-1 font-mono text-sm text-ink">
                  {registered.map((name) => (
                    <li key={name} className="rounded bg-sunken px-2 py-1">
                      {name}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="font-mono text-sm text-ink-subtle">
                  (no tools registered — {mode === 'unavailable' ? 'no WebMCP in this browser' : 'nothing to expose in this state'})
                </p>
              )}
            </section>
          ) : null}

          {tab === 'State' ? (
            <section>
              <p className="mb-3 text-sm text-ink-muted">
                The task record exactly as the server holds it, minus approval tokens.
              </p>
              <Json value={task} />
            </section>
          ) : null}

          {tab === 'Actions' ? (
            <section>
              <p className="mb-3 text-sm text-ink-muted">
                Every tool call made on this page, with what was asked and what came back —
                the log the platform sees.
              </p>
              {calls.length === 0 ? (
                <p className="font-mono text-sm text-ink-subtle">
                  (no tool calls yet on this page)
                </p>
              ) : (
                <ul className="space-y-3">
                  {calls.map((call) => (
                    <li key={call.id} className="rounded-lg border border-line p-3">
                      <p className="font-mono text-sm text-ink">
                        {call.tool}
                        <span
                          className={`ml-2 text-xs ${call.outcome === 'ok' ? 'text-verified' : 'text-mismatch'}`}
                        >
                          {call.outcome} · {call.durationMs}ms
                        </span>
                      </p>
                      <p className="mt-1 text-xs text-ink-subtle">{call.startedAt}</p>
                      <Json value={call.args} label="arguments" />
                      {call.outcome === 'error' ? (
                        <p className="mt-2 font-mono text-xs text-mismatch">{call.error}</p>
                      ) : (
                        <Json value={call.result} label="result" />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          {tab === 'Verification' ? (
            <section>
              <p className="mb-3 text-sm text-ink-muted">
                The deterministic check: each constraint, what was expected, what the site
                actually said, and the revision it was judged against.
              </p>
              {task.verification ? (
                <Json value={task.verification} />
              ) : (
                <p className="font-mono text-sm text-ink-subtle">(not checked yet)</p>
              )}
            </section>
          ) : null}

          {tab === 'Timeline' ? (
            <section>
              <p className="mb-3 text-sm text-ink-muted">
                The append-only audit trail, raw. This is the record the receipt is built
                from — nothing here can be edited.
              </p>
              <ul className="space-y-2">
                {events.map((event, index) => (
                  <li key={index} className="rounded-lg border border-line p-3">
                    <p className="font-mono text-sm text-ink">{event.type}</p>
                    <p className="text-xs text-ink-subtle">{event.at}</p>
                  </li>
                ))}
                {events.length === 0 ? (
                  <li className="font-mono text-sm text-ink-subtle">(empty)</li>
                ) : null}
              </ul>
            </section>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function Json({ value, label }: { value: unknown; label?: string }) {
  return (
    <div className="mt-2">
      {label ? <p className="text-xs text-ink-subtle uppercase">{label}</p> : null}
      <pre className="mt-1 max-h-72 overflow-auto rounded-md bg-sunken p-3 font-mono text-xs leading-relaxed text-ink">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
