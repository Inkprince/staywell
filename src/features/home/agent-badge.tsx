'use client';

/**
 * The agent indicator: small, unobtrusive, honest.
 *
 * "Agent-ready" says the page *can* work with an agent through the browser —
 * it never claims one is connected. No MCP lecture, no jargon.
 */

import { useEffect, useRef, useState } from 'react';

export function AgentBadge() {
  const [open, setOpen] = useState(false);
  const [connected, setConnected] = useState(false);
  const badgeRef = useRef<HTMLButtonElement | null>(null);

  // The platform itself tells us when an agent holds the other end of the
  // tool surface; we only report what it reports.
  useEffect(() => {
    const context = (document as unknown as { modelContext?: { connected?: boolean } }).modelContext;
    if (context && typeof context.connected === 'boolean') setConnected(context.connected);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onClick = (event: MouseEvent) => {
      if (badgeRef.current && !badgeRef.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('click', onClick);
    };
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={badgeRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-xs text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
      >
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-verified' : 'bg-ink-subtle'}`}
        />
        {connected ? 'Agent connected' : 'Agent-ready'}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="About agents"
          className="absolute right-0 z-10 mt-2 w-64 rounded-xl border border-line bg-surface p-4 text-sm leading-relaxed text-ink-muted shadow-sm"
        >
          {connected ? (
            <>
              <p className="font-medium text-ink">Working with an AI agent</p>
              <p className="mt-1">
                Your agent can read the tools this page makes available and help complete
                tasks with you. Approving a change stays yours.
              </p>
            </>
          ) : (
            <>
              <p className="font-medium text-ink">Agent-ready</p>
              <p className="mt-1">
                Proof can work with you directly, or with an AI agent through your browser.
                Either way, every result is checked.
              </p>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
