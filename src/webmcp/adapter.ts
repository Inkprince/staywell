/**
 * Resolves a usable WebMCP implementation, whatever the browser provides.
 *
 * Three outcomes, all of which the product handles:
 *
 *   'native'   — the browser implements `document.modelContext`. This is what
 *                ChatGPT's in-app browser and Chrome 149+ (with
 *                chrome://flags/#enable-webmcp-testing) give us.
 *   'polyfill' — no native support, so the vendored Apache-2.0 polyfill from
 *                GoogleChromeLabs/webmcp-tools is injected. Tools become
 *                discoverable and executable in-page, which keeps the product
 *                and its inspector fully usable in any modern browser.
 *   'unavailable' — neither worked. Proof still functions; only the agent
 *                surface is absent, and the UI says so plainly.
 *
 * Detection deliberately checks `navigator.modelContext` as well. The current
 * spec puts the namespace on `document`, but some pre-standard builds shipped it
 * on `navigator`, and reading both costs nothing.
 */

import type { ModelContext } from './types';

export type WebMCPMode = 'native' | 'polyfill' | 'unavailable';

export interface WebMCPEnvironment {
  mode: WebMCPMode;
  modelContext: ModelContext | null;
  /** True when the namespace was found on `navigator` rather than `document`. */
  legacyNamespace: boolean;
}

const POLYFILL_SRC = '/webmcp-polyfill.js';
const POLYFILL_LOAD_TIMEOUT_MS = 4000;

/** Reads an existing implementation without attempting to install one. */
export function detectModelContext(): WebMCPEnvironment {
  if (typeof document === 'undefined') {
    return { mode: 'unavailable', modelContext: null, legacyNamespace: false };
  }

  if (document.modelContext) {
    return { mode: 'native', modelContext: document.modelContext, legacyNamespace: false };
  }

  if (typeof navigator !== 'undefined' && navigator.modelContext) {
    return { mode: 'native', modelContext: navigator.modelContext, legacyNamespace: true };
  }

  return { mode: 'unavailable', modelContext: null, legacyNamespace: false };
}

function loadPolyfillScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${POLYFILL_SRC}"]`,
    );
    if (existing) {
      // Another caller already started the load; wait for that one.
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('polyfill failed')), {
        once: true,
      });
      return;
    }

    const script = document.createElement('script');
    script.src = POLYFILL_SRC;
    script.async = false;

    const timer = setTimeout(
      () => reject(new Error('polyfill load timed out')),
      POLYFILL_LOAD_TIMEOUT_MS,
    );
    const done = (fn: () => void) => () => {
      clearTimeout(timer);
      fn();
    };

    script.addEventListener('load', done(resolve), { once: true });
    script.addEventListener(
      'error',
      done(() => reject(new Error('polyfill failed to load'))),
      { once: true },
    );

    document.head.appendChild(script);
  });
}

let pending: Promise<WebMCPEnvironment> | null = null;

/**
 * Returns a WebMCP implementation, installing the polyfill if needed.
 * Idempotent and safe to call from many components: the work happens once.
 */
export function ensureModelContext(): Promise<WebMCPEnvironment> {
  if (pending) return pending;

  pending = (async (): Promise<WebMCPEnvironment> => {
    const native = detectModelContext();
    if (native.mode === 'native') return native;

    try {
      await loadPolyfillScript();
    } catch {
      return { mode: 'unavailable', modelContext: null, legacyNamespace: false };
    }

    // The polyfill installs itself synchronously on evaluation.
    if (document.modelContext) {
      return { mode: 'polyfill', modelContext: document.modelContext, legacyNamespace: false };
    }

    return { mode: 'unavailable', modelContext: null, legacyNamespace: false };
  })();

  return pending;
}

/** Test seam: forget the cached resolution so a fresh detection can run. */
export function resetModelContextCache(): void {
  pending = null;
}
