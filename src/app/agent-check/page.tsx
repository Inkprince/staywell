'use client';

/**
 * Agent diagnostics.
 *
 * A permanent surface (not a scratch page) that answers one question honestly:
 * can an agent see and use this page right now? It reads the tool list back from
 * the platform rather than from our own bookkeeping, so what it shows is what an
 * agent would actually discover.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useWebMCP, useWebMCPTools } from '@/webmcp/use-webmcp';
import { toolRegistry } from '@/webmcp/registry';
import { WITHHELD_TOOLS } from '@/webmcp/withheld';
import type { RegisteredTool, ToolDescriptor } from '@/webmcp/types';

const MODE_COPY = {
  native: {
    label: 'Agent-ready',
    detail: 'This browser supports agent tools natively. An agent can work with this page.',
  },
  polyfill: {
    label: 'Agent-ready (compatibility mode)',
    detail:
      'This browser does not support agent tools yet, so Proof loaded a compatibility layer. Everything here still works, and the tools below are real.',
  },
  unavailable: {
    label: 'No agent connection',
    detail:
      'Proof could not make its tools available in this browser. You can still use Proof yourself — nothing about the product depends on an agent being present.',
  },
} as const;

export default function AgentCheckPage() {
  const { mode, ready, registered, calls } = useWebMCP();
  const [platformTools, setPlatformTools] = useState<RegisteredTool[]>([]);
  const [selfTestState, setSelfTestState] = useState<
    { status: 'idle' | 'running' } | { status: 'done'; text: string } | { status: 'failed'; text: string }
  >({ status: 'idle' });

  /**
   * Diagnostic tools. Registered only on this page, which is itself a
   * demonstration of lifecycle gating: navigate away and they disappear from the
   * agent's tool list.
   */
  const tools = useMemo<ToolDescriptor[]>(
    () => [
      {
        name: 'check_proof_connection',
        description:
          'Confirm that you can reach this page and read what Proof can do next. Use this first if you are unsure whether your connection to the page is working.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        execute: () => ({
          connected: true,
          product: 'Proof',
          page: 'agent diagnostics',
          checkedAt: new Date().toISOString(),
          note: 'Connection is working. Go to /workspace to start or continue a task.',
        }),
      },
      {
        name: 'describe_proof_tools',
        description:
          'List what you are able to do on this page, and what Proof deliberately keeps under human control. Read this before planning a task.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        execute: async () => {
          const available = await toolRegistry.listPlatformTools();
          return {
            available: available.map((t) => ({ name: t.name, description: t.description })),
            notAvailableToAgents: WITHHELD_TOOLS,
            principle:
              'The agent proposes. The website knows. The human decides. Proof verifies.',
          };
        },
      },
    ],
    [],
  );

  useWebMCPTools(tools);

  const refreshPlatformTools = useCallback(async () => {
    setPlatformTools(await toolRegistry.listPlatformTools());
  }, []);

  useEffect(() => {
    if (!ready) return;
    void refreshPlatformTools();
  }, [ready, registered.length, refreshPlatformTools]);

  /**
   * Runs a tool the same way an external agent would — through
   * `document.modelContext.executeTool` — so a green result here means the real
   * path works, not that an internal function returned.
   */
  const runSelfTest = useCallback(async () => {
    setSelfTestState({ status: 'running' });
    try {
      const result = await toolRegistry.invoke('check_proof_connection');
      setSelfTestState({ status: 'done', text: JSON.stringify(result, null, 2) });
    } catch (cause) {
      setSelfTestState({
        status: 'failed',
        text: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }, []);

  const copy = MODE_COPY[mode];

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <Link
        href="/"
        className="text-sm text-ink-muted underline decoration-line-strong underline-offset-4 hover:text-ink"
      >
        Proof
      </Link>

      <h1 className="mt-8 font-display text-4xl leading-tight tracking-tight text-ink">
        Agent diagnostics
      </h1>
      <p className="mt-3 max-w-xl text-ink-muted">
        Whether an agent can work with this page, and exactly what it would find.
      </p>

      {/* Status. Carries a label and a shape, never colour alone. */}
      <section
        aria-labelledby="status-heading"
        className="mt-10 rounded-lg border border-line bg-surface p-6"
      >
        <h2 id="status-heading" className="sr-only">
          Connection status
        </h2>
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className={`mt-1.5 size-2.5 shrink-0 rounded-full ${
              mode === 'unavailable' ? 'bg-mismatch' : 'bg-verified'
            }`}
          />
          <div>
            <p className="font-medium text-ink" role="status">
              {copy.label}
            </p>
            <p className="mt-1 text-sm text-ink-muted">{copy.detail}</p>
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
              <dt className="text-ink-subtle">Implementation</dt>
              <dd className="text-ink">
                {mode === 'native'
                  ? 'document.modelContext (native)'
                  : mode === 'polyfill'
                    ? 'document.modelContext (polyfill)'
                    : 'none'}
              </dd>
              <dt className="text-ink-subtle">Tools on this page</dt>
              <dd className="text-ink">{platformTools.length}</dd>
            </dl>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-5">
          <button
            type="button"
            onClick={runSelfTest}
            disabled={!ready || selfTestState.status === 'running'}
            className="rounded-md bg-cobalt px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cobalt-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {selfTestState.status === 'running' ? 'Checking…' : 'Run a test call'}
          </button>
          <p className="text-sm text-ink-subtle">
            Calls a tool the same way an agent would.
          </p>
        </div>

        {selfTestState.status === 'done' || selfTestState.status === 'failed' ? (
          <div className="mt-4">
            <p className="text-sm font-medium text-ink">
              {selfTestState.status === 'done' ? '✓ The call worked' : '✕ The call failed'}
            </p>
            <pre className="mt-2 overflow-x-auto rounded-md bg-sunken p-4 text-xs leading-relaxed text-ink-muted">
              {selfTestState.text}
            </pre>
          </div>
        ) : null}
      </section>

      {/* What the agent can see. */}
      <section aria-labelledby="tools-heading" className="mt-10">
        <h2 id="tools-heading" className="text-sm font-medium tracking-wide text-ink-subtle uppercase">
          What an agent can do here
        </h2>
        {platformTools.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">No tools are registered on this page.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface">
            {platformTools.map((tool) => (
              <li key={tool.name} className="p-4">
                <p className="font-mono text-sm text-ink">{tool.name}</p>
                <p className="mt-1 text-sm text-ink-muted">{tool.description}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* What the agent cannot do. */}
      <section aria-labelledby="withheld-heading" className="mt-10">
        <h2
          id="withheld-heading"
          className="text-sm font-medium tracking-wide text-ink-subtle uppercase"
        >
          What stays with you
        </h2>
        <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface">
          {WITHHELD_TOOLS.map((tool) => (
            <li key={tool.name} className="p-4">
              <p className="font-mono text-sm text-ink-subtle line-through">{tool.name}</p>
              <p className="mt-1 text-sm text-ink-muted">{tool.reason}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* Call log. */}
      <section aria-labelledby="log-heading" className="mt-10">
        <h2 id="log-heading" className="text-sm font-medium tracking-wide text-ink-subtle uppercase">
          Recent calls
        </h2>
        {calls.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">Nothing has been called yet.</p>
        ) : (
          <ol className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface">
            {calls.map((call) => (
              <li key={call.id} className="flex items-baseline gap-3 p-4 text-sm">
                <span aria-hidden="true" className={call.outcome === 'ok' ? 'text-verified' : 'text-mismatch'}>
                  {call.outcome === 'ok' ? '✓' : '✕'}
                </span>
                <span className="font-mono text-ink">{call.tool}</span>
                <span className="text-ink-subtle">{call.durationMs}ms</span>
                <span className="sr-only">
                  {call.outcome === 'ok' ? 'succeeded' : `failed: ${call.error}`}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
