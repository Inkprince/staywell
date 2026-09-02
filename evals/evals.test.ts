/**
 * The eval runner: executes every scenario, aggregates the
 * measured numbers, and writes `evals/report.json` + `evals/report.md`.
 *
 * Two global properties are asserted, not just reported:
 *
 * 1. **Zero false completions** — no scenario ever ends with a task marked
 *    VERIFIED that the independent auditor disagrees with.
 * 2. **Total enforcement** — every commit attempted by the agent surface, every
 *    approval attempted without a human's nonce, and every plan staged against
 *    a revision the world has moved past was refused. Not most. Every one.
 */

import { afterAll, describe, it } from 'vitest';
import { expect } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freshMetrics, type Metrics } from './harness';
import { SCENARIOS } from './scenarios';

const EVALS_DIR = path.dirname(fileURLToPath(import.meta.url));

const metrics = freshMetrics();
const failures: { id: string; category: string; error: string }[] = [];

// Deterministic by seed and by declaration order — the report is reproducible.
describe('the eval suite', () => {
  for (const scenario of SCENARIOS) {
    it(`${scenario.category} — ${scenario.id}`, () => {
      try {
        scenario.run(metrics);
      } catch (cause) {
        failures.push({
          id: scenario.id,
          category: scenario.category,
          error: cause instanceof Error ? cause.message : String(cause),
        });
        throw cause;
      }
    });
  }

  it('summary — every scenario passed', () => {
    expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
  });

  it('summary — zero false completions across the suite', () => {
    expect(metrics.falseCompletions).toBe(0);
  });

  it('summary — every agent commit attempt was rejected', () => {
    expect(metrics.agentCommitAttempts).toBeGreaterThan(0);
    expect(metrics.agentCommitRejected).toBe(metrics.agentCommitAttempts);
  });

  it('summary — every unauthorised approval attempt was rejected', () => {
    expect(metrics.agentApproveAttempts).toBeGreaterThan(0);
    expect(metrics.agentApproveRejected).toBe(metrics.agentApproveAttempts);
  });

  it('summary — every stale plan was rejected', () => {
    expect(metrics.stalePlanAttempts).toBeGreaterThan(0);
    expect(metrics.stalePlanRejected).toBe(metrics.stalePlanAttempts);
  });

  afterAll(async () => {
    const categories = [...new Set(SCENARIOS.map((s) => s.category))];
    const byCategory = categories.map((category) => ({
      category,
      scenarios: SCENARIOS.filter((s) => s.category === category).length,
    }));

    const report = {
      generatedAt: new Date().toISOString(),
      scenarioCount: SCENARIOS.length,
      categories: byCategory,
      metrics,
      enforcement: {
        agentCommitsRejected: `${metrics.agentCommitRejected}/${metrics.agentCommitAttempts}`,
        unauthorisedApprovalsRejected: `${metrics.agentApproveRejected}/${metrics.agentApproveAttempts}`,
        stalePlansRejected: `${metrics.stalePlanRejected}/${metrics.stalePlanAttempts}`,
        falseCompletions: metrics.falseCompletions,
      },
      results: SCENARIOS.map((s) => {
        const failure = failures.find((f) => f.id === s.id);
        return {
          id: s.id,
          category: s.category,
          description: s.description,
          pass: !failure,
          error: failure?.error ?? null,
        };
      }),
    };

    await mkdir(EVALS_DIR, { recursive: true });
    await writeFile(path.join(EVALS_DIR, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    const lines = [
      '# Eval report',
      '',
      `Generated ${report.generatedAt} by \`pnpm evals\` — deterministic by seed; the same run always produces the same numbers.`,
      '',
      `**${SCENARIOS.length} scenarios** across ${categories.length} categories (${byCategory
        .map((c) => `${c.scenarios} ${c.category}`)
        .join(', ')}).`,
      '',
      '## The measured numbers',
      '',
      '| What | Count |',
      '| --- | ---: |',
      `| Tasks created | ${metrics.tasksCreated} |`,
      `| Changes committed (all human-approved) | ${metrics.commitsApplied} |`,
      `| Mismatches caught | ${metrics.mismatchesCaught} |`,
      `| False completions | ${metrics.falseCompletions} |`,
      `| Agent commit attempts rejected | ${metrics.agentCommitRejected}/${metrics.agentCommitAttempts} |`,
      `| Unauthorised approvals rejected | ${metrics.agentApproveRejected}/${metrics.agentApproveAttempts} |`,
      `| Stale plans rejected | ${metrics.stalePlanRejected}/${metrics.stalePlanAttempts} |`,
      '',
      'The mismatch count is not a failure count. A caught mismatch is the product working: the world honestly disagreed with the plan, and Proof said so instead of calling the task complete.',
      '',
      '## Every scenario',
      '',
      '| # | Category | Scenario | Result |',
      '| --: | --- | --- | --- |',
      ...report.results.map(
        (r, index) => `| ${index + 1} | ${r.category} | ${r.description} | ${r.pass ? 'pass' : `**FAIL** — ${r.error}`} |`,
      ),
      '',
    ].join('\n');

    await writeFile(path.join(EVALS_DIR, 'report.md'), lines, 'utf8');
  });
});
