/**
 * The boundary test.
 *
 * The agent surface is safe only if it is *structurally* safe: no import path
 * from `src/webmcp/**` may reach the commit, approval, or store layers. If
 * someone adds a convenience import tomorrow, this fails before the product
 * ships it.
 *
 * Mechanism: follow static import specifiers transitively from every module
 * under `src/webmcp/`, resolving `@/` aliases and relative paths by hand, and
 * assert the closure never touches the forbidden modules.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = resolve(process.cwd(), 'src');

const FORBIDDEN_SUBSTRINGS = [
  'lib/proof/transaction',
  'lib/proof/policy',
  'lib/store',
  'lib/proof/audit',
] as const;

/** Modules the webmcp layer must never import, directly or transitively. */
function isForbidden(file: string): boolean {
  const normalised = file.replaceAll('\\', '/');
  return FORBIDDEN_SUBSTRINGS.some((fragment) => normalised.includes(fragment));
}

/** Extracts static import/export-from specifiers from TS/TSX source. */
function importSpecifiers(code: string): string[] {
  const patterns = [
    /import\s[^'";]*?from\s*['"]([^'"]+)['"]/g,
    /export\s[^'";]*?from\s*['"]([^'"]+)['"]/g,
    /import\s*['"]([^'"]+)['"]/g,
  ];
  const specs: string[] = [];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) specs.push(match[1]!);
  }
  return specs;
}

function resolveSpecifier(spec: string, fromFile: string): string | null {
  const target = spec.startsWith('@/')
    ? join(SRC_ROOT, spec.slice(2))
    : spec.startsWith('.')
      ? resolve(dirname(fromFile), spec)
      : null; // bare specifier → node_modules, out of scope
  if (!target) return null;

  for (const suffix of ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx']) {
    const candidate = target + suffix;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Every file reachable from `roots` through static imports. */
function importClosure(roots: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...roots];

  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);

    if (!/\.(ts|tsx|js|jsx)$/.test(file)) continue;
    const code = readFileSync(file, 'utf8');
    for (const spec of importSpecifiers(code)) {
      const resolved = resolveSpecifier(spec, file);
      if (resolved && !seen.has(resolved)) queue.push(resolved);
    }
  }

  return seen;
}

const WEBMCP_MODULES = [
  join(SRC_ROOT, 'webmcp', 'adapter.ts'),
  join(SRC_ROOT, 'webmcp', 'registry.ts'),
  join(SRC_ROOT, 'webmcp', 'types.ts'),
  join(SRC_ROOT, 'webmcp', 'use-webmcp.ts'),
  join(SRC_ROOT, 'webmcp', 'withheld.ts'),
];

describe('the agent surface boundary', () => {
  it('webmcp modules exist to be checked', () => {
    for (const file of WEBMCP_MODULES) {
      expect(existsSync(file)).toBe(true);
    }
  });

  it('imports nothing from the transaction, policy, store, or audit layers', () => {
    const closure = importClosure(WEBMCP_MODULES);

    const violations = [...closure].filter(isForbidden);

    expect(violations).toEqual([]);
  });

  it('never names the human-only operations outside the withheld list', () => {
    const closure = importClosure(WEBMCP_MODULES);
    const humanOnly = ['approveChange', 'commitStaged', 'issueApprovalNonce', 'verifyResult'];

    const offenders = [...closure].filter((file) => {
      // withheld.ts names these deliberately, to tell agents what they lack.
      if (file.endsWith(`${sep}withheld.ts`)) return false;
      const code = readFileSync(file, 'utf8');
      return humanOnly.some((name) => code.includes(name));
    });

    expect(offenders).toEqual([]);
  });
});
