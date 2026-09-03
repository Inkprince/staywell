'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { toolRegistry, type RegistrySnapshot } from './registry';
import type { ToolDescriptor } from './types';

const SERVER_SNAPSHOT: RegistrySnapshot = {
  mode: 'unavailable',
  ready: false,
  registered: [],
  calls: [],
};

/** Live view of the agent surface: which implementation, which tools, what was called. */
export function useWebMCP(): RegistrySnapshot {
  return useSyncExternalStore(
    toolRegistry.subscribe,
    toolRegistry.getSnapshot,
    () => SERVER_SNAPSHOT,
  );
}

/**
 * Registers `descriptors` for as long as the component is mounted, and keeps the
 * registered set converged on whatever is passed.
 *
 * Re-syncs only when the *set of tool identities* changes — name plus the
 * descriptor's `syncKey` (for task tools, the task id) — which is what gating
 * needs. Handlers read application state at call time rather than closing over
 * a render-time snapshot, and the registry keeps an existing registration when
 * the identity is unchanged, so identity churn never tears the surface down.
 * Every handler in `webmcp/tools` follows that rule.
 */
export function useWebMCPTools(descriptors: readonly ToolDescriptor[]): void {
  const signature = useMemo(
    () => descriptors.map((d) => `${d.name}=${d.syncKey ?? ''}`).sort().join('|'),
    [descriptors],
  );

  useEffect(() => {
    let cancelled = false;

    void toolRegistry.sync(descriptors).catch((cause) => {
      if (!cancelled) console.error('[webmcp] tool sync failed', cause);
    });

    return () => {
      cancelled = true;
    };
    // `descriptors` is intentionally excluded: identity churns every render, and
    // the name set is the thing that must drive re-registration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  useEffect(() => () => void toolRegistry.releaseAll(), []);
}
