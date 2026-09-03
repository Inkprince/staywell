'use client';

/**
 * Agent preflight (`/agent-check`).
 *
 * The page a judge opens before testing Proof with a real external agent. It
 * answers three questions unambiguously:
 *
 * 1. Is this browser running the *native* WebMCP surface, a fallback, or
 *    nothing? (A pass/fail check, not a vibe.)
 * 2. How do I test this in ChatGPT, in the shortest possible flow?
 * 3. What did the agent actually call, and was it a real WebMCP call?
 *
 * Everything shown is read back from the platform — the tool list comes from
 * `getTools()`, the self-test goes through `executeTool()` — so the page cannot
 * claim readiness the platform would contradict. Calls this page makes itself
 * are labelled as such; only the platform's own dispatches are labelled
 * external.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useWebMCP, useWebMCPTools } from '@/webmcp/use-webmcp';
import { toolRegistry } from '@/webmcp/registry';
import { WITHHELD_TOOLS } from '@/webmcp/withheld';
import type { RegisteredTool, ToolDescriptor } from '@/webmcp/types';
import { StayWellNav } from '@/features/staywell/staywell-nav';

type Tone = 'pass' | 'fallback' | 'fail';

const VERDICT_COPY: Record<Tone, { label: string; detail: string }> = {
  pass: {
    label: 'Ready — native WebMCP is live',
    detail:
      'This browser implements document.modelContext. An agent on the other side of it (ChatGPT’s in-app browser, or Chrome with the WebMCP flag) can discover and call this page’s tools for real.',
  },
  fallback: {
    label: 'Fallback mode — not the native path',
    detail:
      'This browser does not implement document.modelContext, so Proof loaded a compatibility layer. The tools below are real and callable in this page, but this is not the path judges should test. Open the site in ChatGPT’s in-app browser for the native surface.',
  },
  fail: {
    label: 'No agent connection',
    detail:
      'Proof could not make its tools available in this browser. The product still works for you — only the agent surface is absent. Open the site in ChatGPT’s in-app browser, or in Chrome with the WebMCP flag enabled.',
  },
};

export default function AgentCheckPage() {
  const { mode, ready, registered, calls } = useWebMCP();
  const [platformTools, setPlatformTools] = useState<RegisteredTool[]>([]);
  const [origin, setOrigin] = useState('');
  const [selfTestState, setSelfTestState] = useState<
    | { status: 'idle' | 'running' }
    | { status: 'done'; text: string }
    | { status: 'failed'; text: string }
  >({ status: 'idle' });

  /**
   * Preflight tools. Registered only on this page, which is itself a
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
          page: 'agent preflight',
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
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (!ready) return;
    void refreshPlatformTools();
  }, [ready, registered.length, refreshPlatformTools]);

  /**
   * Runs a tool the same way an external agent would — through
   * `document.modelContext.executeTool` — so a green result here means the real
   * path works, not that an internal function returned. The call is labelled
   * "this page" in the log below; a call ChatGPT makes is labelled "external".
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

  const tone: Tone = mode === 'native' ? 'pass' : mode === 'polyfill' ? 'fallback' : 'fail';
  const verdict = VERDICT_COPY[tone];

  const externalCalls = calls.filter((call) => call.source === 'external');
  const pageCalls = calls.filter((call) => call.source === 'page');

  return (
    <main className="min-h-dvh bg-canvas"><StayWellNav />
      <div className="mx-auto max-w-3xl px-6 pt-32 pb-24 lg:pt-36">
      <p className="text-xs font-medium tracking-[0.22em] text-cobalt uppercase">Before you test</p>

      <h1 className="mt-4 font-display text-4xl leading-tight tracking-tight text-ink md:text-5xl">
        Agent preflight
      </h1>
      <p className="mt-4 max-w-xl text-lg leading-relaxed text-ink-muted">
        Check the connection before you test Proof with a real agent — then follow
        the flow below in ChatGPT.
      </p>

      {/* The verdict. Carries a label and a shape, never colour alone. */}
      <section
        aria-labelledby="verdict-heading"
        className={`mt-10 rounded-[2.5rem] border p-6 sm:p-8 ${
          tone === 'pass'
            ? 'border-verified-line bg-verified-soft/60'
            : tone === 'fallback'
              ? 'border-caution-line bg-caution-soft/60'
              : 'border-mismatch-line bg-mismatch-soft/60'
        }`}
      >
        <h2 id="verdict-heading" className="sr-only">
          Preflight verdict
        </h2>
        <p className="font-display text-2xl tracking-tight text-ink" role="status">
          <span aria-hidden="true" className="mr-2">
            {tone === 'pass' ? '✓' : tone === 'fallback' ? '!' : '✕'}
          </span>
          {verdict.label}
        </p>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
          {verdict.detail}
        </p>

        <ul className="mt-5 space-y-1.5 border-t border-line pt-4 text-sm">
          <CheckRow
            ok={mode === 'native'}
            label="document.modelContext is implemented natively"
            detail={
              mode === 'native'
                ? 'the platform owns the tool surface'
                : mode === 'polyfill'
                  ? 'a compatibility layer is standing in — fallback, not the judged path'
                  : 'not present in this browser'
            }
          />
          <CheckRow
            ok={platformTools.length > 0}
            label={`Tools registered, read back from the platform (${platformTools.length})`}
            detail={
              platformTools.length > 0
                ? 'getTools() returns what this page registered'
                : ready
                  ? 'nothing registered yet — this page registers two tools on load'
                  : 'the tool surface has not initialised yet'
            }
          />
          <CheckRow
            ok={selfTestState.status === 'done'}
            label="A test call executed through the platform"
            detail={
              selfTestState.status === 'done'
                ? 'executeTool() returned the tool’s result — the same path an agent uses'
                : selfTestState.status === 'failed'
                  ? 'the last attempt failed — see the result below'
                  : 'not run yet — use the button below'
            }
          />
        </ul>

        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-5">
          <button
            type="button"
            onClick={runSelfTest}
            disabled={!ready || selfTestState.status === 'running'}
            className="rounded-full bg-cobalt px-6 py-3 text-sm font-medium text-white transition hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {selfTestState.status === 'running' ? 'Checking…' : 'Run a test call'}
          </button>
          <p className="text-sm text-ink-subtle">
            Calls a tool the same way an agent would. Runs from this page, so the
            log labels it “this page”.
          </p>
        </div>

        {selfTestState.status === 'done' || selfTestState.status === 'failed' ? (
          <div className="mt-4">
            <p className="text-sm font-medium text-ink">
              {selfTestState.status === 'done' ? '✓ The call worked' : '✕ The call failed'}
            </p>
            <pre className="mt-2 overflow-x-auto rounded-2xl bg-sunken p-4 text-xs leading-relaxed text-ink-muted">
              {selfTestState.text}
            </pre>
          </div>
        ) : null}
      </section>

      {/* The judging flow. */}
      <section aria-labelledby="howto-heading" className="mt-10">
        <h2
          id="howto-heading"
          className="text-xs font-medium tracking-[0.18em] text-ink-subtle uppercase"
        >
          How to test in ChatGPT
        </h2>
        <ol className="mt-4 space-y-4">
          <Step n={1}>
            Copy this site’s address:{' '}
            <code className="rounded bg-sunken px-1.5 py-0.5 font-mono text-sm text-ink">
              {origin || 'this site'}
            </code>
          </Step>
          <Step n={2}>
            In ChatGPT, open the in-app browser and go to that address. (In the
            composer, paste the link and open it with the browser.) The page you
            are reading now loads there too — this preflight works inside
            ChatGPT.
          </Step>
          <Step n={3}>
            Ask the agent:{' '}
            <em className="text-ink">
              “What tools does this page give you? Call check_proof_connection.”
            </em>{' '}
            It should name the two tools below, run the call — and it will appear
            in “Recent calls” labelled <CallBadge source="external" />. Every
            entry there arrived through document.modelContext; nothing is
            simulated.
          </Step>
          <Step n={4}>
            Ask it what it is <em className="text-ink">not</em> allowed to do. It
            will tell you: approving, committing, and declaring success do not
            exist on its side of the line.
          </Step>
          <Step n={5}>
            Then the full flow: open{' '}
            <Link href="/workspace" className="text-cobalt hover:underline">
              the workspace
            </Link>
            , start a task — “Move my reservation to Friday, keep the same room,
            and stay under $300.” — and have the agent work it there. Its tool
            list changes as the task advances (watch the Inspect panel), and the
            approval is always yours.
          </Step>
        </ol>
        <p className="mt-5 text-sm text-ink-subtle">
          The exact way to reach the in-app browser changes with ChatGPT
          versions; any path that loads the page in ChatGPT’s browser works.
        </p>
      </section>

      {/* What the agent can see. */}
      <section aria-labelledby="tools-heading" className="mt-10">
        <h2
          id="tools-heading"
          className="text-xs font-medium tracking-[0.18em] text-ink-subtle uppercase"
        >
          What an agent can do here
        </h2>
        {platformTools.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">No tools are registered on this page.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line rounded-[2rem] border border-line bg-surface">
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
          className="text-xs font-medium tracking-[0.18em] text-ink-subtle uppercase"
        >
          What stays with you
        </h2>
        <ul className="mt-3 divide-y divide-line rounded-[2rem] border border-line bg-surface">
          {WITHHELD_TOOLS.map((tool) => (
            <li key={tool.name} className="p-4">
              <p className="font-mono text-sm text-ink-subtle line-through">{tool.name}</p>
              <p className="mt-1 text-sm text-ink-muted">{tool.reason}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* Call log, by provenance. */}
      <section aria-labelledby="log-heading" className="mt-10">
        <h2
          id="log-heading"
          className="text-xs font-medium tracking-[0.18em] text-ink-subtle uppercase"
        >
          Recent calls
        </h2>
        <p className="mt-2 text-sm text-ink-muted">
          Every entry arrived through document.modelContext.{' '}
          <CallBadge source="external" /> means the platform dispatched it — a
          real WebMCP call from an agent. <CallBadge source="page" /> means this
          page invoked it (the self-test above). Proof’s built-in fallback pilot
          runs server-side over HTTP and never appears in this log.
        </p>
        {calls.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">
            Nothing has been called yet. Run the test call above, or ask an agent
            in ChatGPT to call <span className="font-mono">check_proof_connection</span>.
          </p>
        ) : (
          <ol className="mt-3 divide-y divide-line rounded-[2rem] border border-line bg-surface">
            {calls.map((call) => (
              <li key={call.id} className="flex flex-wrap items-baseline gap-3 p-4 text-sm">
                <span
                  aria-hidden="true"
                  className={call.outcome === 'ok' ? 'text-verified' : 'text-mismatch'}
                >
                  {call.outcome === 'ok' ? '✓' : '✕'}
                </span>
                <span className="font-mono text-ink">{call.tool}</span>
                <CallBadge source={call.source} />
                <span className="text-ink-subtle">{call.durationMs}ms</span>
                <span className="sr-only">
                  {call.outcome === 'ok' ? 'succeeded' : `failed: ${call.error}`}
                </span>
              </li>
            ))}
          </ol>
        )}
        {externalCalls.length === 0 && pageCalls.length > 0 ? (
          <p className="mt-3 text-sm text-ink-subtle">
            Only this page’s own calls so far. No external agent has used these
            tools yet — that is the part to try in ChatGPT.
          </p>
        ) : null}
      </section>
      </div>
    </main>
  );
}

function CheckRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <li className="flex items-baseline gap-2.5">
      <span aria-hidden="true" className={ok ? 'text-verified' : 'text-ink-subtle'}>
        {ok ? '✓' : '○'}
      </span>
      <span>
        <span className="text-ink">{label}</span>
        <span className="sr-only">{ok ? ' (passing)' : ' (not yet)'}</span>
        <span className="block text-ink-subtle">{detail}</span>
      </span>
    </li>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sunken text-xs font-medium text-ink"
      >
        {n}
      </span>
      <div className="leading-relaxed text-ink-muted">{children}</div>
    </li>
  );
}

function CallBadge({ source }: { source: 'external' | 'page' }) {
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 font-mono text-xs ${
        source === 'external' ? 'bg-verified-soft text-ink' : 'bg-sunken text-ink-subtle'
      }`}
    >
      {source === 'external' ? 'external · WebMCP' : 'this page'}
      <span className="sr-only">
        {source === 'external'
          ? ' (dispatched by the platform, a real WebMCP call)'
          : ' (invoked by this page)'}
      </span>
    </span>
  );
}
