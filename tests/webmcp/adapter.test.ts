import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  detectModelContext,
  ensureModelContext,
  resetModelContextCache,
} from '@/webmcp/adapter';
import { FakeModelContext } from './fake-model-context';

function installOnDocument(): FakeModelContext {
  const ctx = new FakeModelContext();
  Object.defineProperty(document, 'modelContext', {
    value: ctx,
    configurable: true,
  });
  return ctx;
}

function installOnNavigator(): FakeModelContext {
  const ctx = new FakeModelContext();
  Object.defineProperty(window.navigator, 'modelContext', {
    value: ctx,
    configurable: true,
  });
  return ctx;
}

function uninstall(): void {
  delete (document as { modelContext?: unknown }).modelContext;
  delete (window.navigator as { modelContext?: unknown }).modelContext;
}

beforeEach(() => {
  resetModelContextCache();
});

afterEach(() => {
  uninstall();
});

describe('detectModelContext', () => {
  it('reports native when document.modelContext exists', () => {
    installOnDocument();
    expect(detectModelContext()).toEqual({
      mode: 'native',
      modelContext: expect.any(FakeModelContext),
      legacyNamespace: false,
    });
  });

  it('reports native with the legacy flag when only navigator.modelContext exists', () => {
    installOnNavigator();
    const env = detectModelContext();
    expect(env.mode).toBe('native');
    expect(env.legacyNamespace).toBe(true);
  });

  it('reports unavailable when neither namespace is present', () => {
    expect(detectModelContext().mode).toBe('unavailable');
  });
});

describe('ensureModelContext', () => {
  it('resolves to the native implementation without touching the DOM', async () => {
    installOnDocument();
    const before = document.querySelectorAll('script').length;

    const env = await ensureModelContext();

    expect(env.mode).toBe('native');
    expect(document.querySelectorAll('script').length).toBe(before);
  });

  it('resolves once and returns the same promise to concurrent callers', async () => {
    installOnDocument();
    const a = ensureModelContext();
    const b = ensureModelContext();
    expect(a).toBe(b);
    await a;
  });
});
